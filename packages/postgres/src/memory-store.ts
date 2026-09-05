import { sql } from "drizzle-orm";
import { defaultDecayStrategy } from "@mnemo/core";
import type {
  Ctx,
  GroupCount,
  Memory,
  MemoryId,
  MemoryStatus,
  MemoryStore,
  NewMemory,
  NewObservation,
  Observation,
  RecallId,
  RecallScope,
} from "@mnemo/core";
import type { Db } from "./client.js";
import { rowToMemory, rowToObservation, type MemoryRow, type ObservationRow } from "./mapping.js";

/**
 * `MemoryStore` の Postgres 実装（docs/architecture.md §5.1、docs/memory-model.md §10）。
 *
 * クエリは drizzle-orm の `sql` タグ付きテンプレートで書く。冪等な作成
 * （`createObservation` / `createMemory`）は `INSERT ... ON CONFLICT (...) WHERE ... DO NOTHING
 * RETURNING *` を使い、行が返らなかった場合（＝既存行と衝突した場合）だけ追加の SELECT で
 * 既存行を取得する。`ON CONFLICT` の衝突検出はテーブルの一意索引そのものが担うため、
 * 同時実行でも正しく機能する（先に commit した側の行だけが見える）。
 */
export class PostgresMemoryStore implements MemoryStore {
  constructor(private readonly db: Db) {}

  async createObservation(ctx: Ctx, input: NewObservation): Promise<Observation> {
    const externalId = input.externalId ?? null;
    const inserted = await this.db.execute(sql`
      INSERT INTO observations (id, tenant_id, subject_id, external_id, kind, payload, occurred_at, recorded_at)
      VALUES (
        gen_random_uuid(),
        ${ctx.tenantId},
        ${input.subjectId ?? null},
        ${externalId},
        ${input.kind},
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.occurredAt ?? null},
        ${input.recordedAt ?? new Date()}
      )
      ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
      DO NOTHING
      RETURNING *
    `);
    if (inserted.rows.length > 0) {
      return rowToObservation(inserted.rows[0] as unknown as ObservationRow);
    }

    // externalId が null の場合は一意制約の対象外なので、ここに来るのは externalId が
    // 非 null で既存行と衝突したときだけである。
    const existing = await this.db.execute(sql`
      SELECT * FROM observations
      WHERE tenant_id = ${ctx.tenantId} AND external_id = ${externalId}
      LIMIT 1
    `);
    return rowToObservation(existing.rows[0] as unknown as ObservationRow);
  }

  async createMemory(ctx: Ctx, input: NewMemory): Promise<Memory> {
    const sourceObservationId = input.sourceObservationId ?? null;
    const extractorVersion = input.extractorVersion ?? null;
    const provenanceKind = input.provenance.kind;

    const inserted = await this.db.execute(sql`
      INSERT INTO memories (
        id, tenant_id, subject_id,
        source_observation_id, extractor_version,
        content, content_hash, digest, digest_source,
        provenance_kind, provenance,
        status, superseded_by_id, contested_with_id,
        tags,
        occurred_at, recorded_at, last_reinforced_at,
        strength, half_life_hours, decay_floor_at,
        embedding_status,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${ctx.tenantId}, ${input.subjectId ?? null},
        ${sourceObservationId}, ${extractorVersion},
        ${input.content}, ${input.contentHash}, ${input.digest}, ${input.digestSource},
        ${provenanceKind}, ${JSON.stringify(input.provenance)}::jsonb,
        ${input.status ?? "active"}, ${input.supersededById ?? null}, ${input.contestedWithId ?? null},
        ${sql.param(input.tags)},
        ${input.occurredAt ?? null}, ${input.recordedAt}, ${input.lastReinforcedAt ?? null},
        ${input.strength}, ${input.halfLifeHours}, ${input.decayFloorAt},
        ${input.embeddingStatus},
        now(), now()
      )
      ON CONFLICT (tenant_id, source_observation_id, extractor_version, content_hash)
        WHERE source_observation_id IS NOT NULL
      DO NOTHING
      RETURNING *
    `);
    if (inserted.rows.length > 0) {
      return rowToMemory(inserted.rows[0] as unknown as MemoryRow);
    }

    const existing = await this.db.execute(sql`
      SELECT * FROM memories
      WHERE tenant_id = ${ctx.tenantId}
        AND source_observation_id = ${sourceObservationId}
        AND extractor_version IS NOT DISTINCT FROM ${extractorVersion}
        AND content_hash = ${input.contentHash}
      LIMIT 1
    `);
    return rowToMemory(existing.rows[0] as unknown as MemoryRow);
  }

  async get(ctx: Ctx, id: MemoryId): Promise<Memory | null> {
    const result = await this.db.execute(sql`
      SELECT * FROM memories WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1
    `);
    return result.rows.length > 0 ? rowToMemory(result.rows[0] as unknown as MemoryRow) : null;
  }

  async getMany(ctx: Ctx, ids: MemoryId[]): Promise<Memory[]> {
    if (ids.length === 0) {
      return [];
    }
    const result = await this.db.execute(sql`
      SELECT * FROM memories WHERE tenant_id = ${ctx.tenantId} AND id = ANY(${sql.param(ids)}::uuid[])
    `);
    return result.rows.map((row) => rowToMemory(row as unknown as MemoryRow));
  }

  async updateStatus(
    ctx: Ctx,
    id: MemoryId,
    status: MemoryStatus,
    opts?: { supersededById?: MemoryId },
  ): Promise<Memory> {
    const result = await this.db.execute(sql`
      UPDATE memories
      SET status = ${status},
          superseded_by_id = COALESCE(${opts?.supersededById ?? null}, superseded_by_id),
          updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${id}
      RETURNING *
    `);
    if (result.rows.length === 0) {
      throw new Error(`PostgresMemoryStore: memory not found for tenant: ${id}`);
    }
    return rowToMemory(result.rows[0] as unknown as MemoryRow);
  }

  async reinforce(ctx: Ctx, id: MemoryId, at: Date): Promise<Memory> {
    const current = await this.db.execute(sql`
      SELECT * FROM memories WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1
    `);
    if (current.rows.length === 0) {
      throw new Error(`PostgresMemoryStore: memory not found for tenant: ${id}`);
    }
    const memory = rowToMemory(current.rows[0] as unknown as MemoryRow);
    const decayFloorAt = defaultDecayStrategy.floorAt({
      recordedAt: memory.recordedAt,
      lastReinforcedAt: at,
      strength: memory.strength,
      halfLifeHours: memory.halfLifeHours,
    });

    const updated = await this.db.execute(sql`
      UPDATE memories
      SET last_reinforced_at = ${at}, decay_floor_at = ${decayFloorAt}, updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${id}
      RETURNING *
    `);
    return rowToMemory(updated.rows[0] as unknown as MemoryRow);
  }

  async recordUsage(
    ctx: Ctx,
    recallId: RecallId,
    memoryIds: MemoryId[],
  ): Promise<{ insertedMemoryIds: MemoryId[] }> {
    if (memoryIds.length === 0) {
      return { insertedMemoryIds: [] };
    }
    const result = await this.db.execute(sql`
      INSERT INTO recall_usages (tenant_id, recall_id, memory_id, used_at)
      SELECT ${ctx.tenantId}, ${recallId}, m, now()
      FROM unnest(${sql.param(memoryIds)}::uuid[]) AS m
      ON CONFLICT (tenant_id, recall_id, memory_id) DO NOTHING
      RETURNING memory_id
    `);
    return {
      insertedMemoryIds: result.rows.map(
        (row) => (row as unknown as { memory_id: string }).memory_id,
      ),
    };
  }

  async countByGroup(ctx: Ctx, scope: RecallScope): Promise<GroupCount[]> {
    const conditions = [sql`tenant_id = ${ctx.tenantId}`];
    if (scope.subjectId !== undefined) {
      conditions.push(sql`subject_id = ${scope.subjectId}`);
    }
    if (scope.occurredAfter !== undefined) {
      conditions.push(sql`occurred_at >= ${scope.occurredAfter}`);
    }
    if (scope.occurredBefore !== undefined) {
      conditions.push(sql`occurred_at <= ${scope.occurredBefore}`);
    }
    const whereClause = sql.join(conditions, sql` AND `);

    const result = await this.db.execute(sql`
      SELECT subject_id AS key, count(*)::int AS count
      FROM memories
      WHERE ${whereClause}
      GROUP BY subject_id
    `);
    return result.rows.map((row) => {
      const r = row as unknown as { key: string | null; count: number };
      return { axis: "subject" as const, key: r.key, count: r.count, countKind: "exact" as const };
    });
  }
}
