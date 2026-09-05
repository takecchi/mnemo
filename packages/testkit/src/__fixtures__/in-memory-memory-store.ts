import { defaultDecayStrategy } from "@mnemo/core";
import type {
  Ctx,
  EmbeddingStatus,
  GroupCount,
  Memory,
  MemoryId,
  MemoryStatus,
  MemoryStore,
  NewMemory,
  NewObservation,
  Observation,
  ObservationId,
  OutboxJobKind,
  OutboxJobRecord,
  RecallId,
  RecallScope,
} from "@mnemo/core";
import { nextId } from "./id.js";

/**
 * `MemoryStore` のインメモリ・プレースホルダ実装。
 *
 * **本番用途ではない。** `packages/testkit` の適合テストが実際に実行できることを示す
 * ためだけの最小実装であり、`packages/postgres`（段階2）が実装すべき振る舞いの
 * 完全な参照ではない。特に索引・永続化・トランザクションは一切模していない。
 *
 * roadmap.md 段階3で `outboxJobs` を公開した。`InMemoryOutboxStore`
 * （`./in-memory-outbox-store.js`）にこの配列をそのまま渡すことで、`createObservationWithOutbox` /
 * `createMemoryWithOutbox` が積んだジョブを `OutboxStore` 側から claim/complete/fail できる
 * （`packages/postgres` が同一 DB・同一トランザクションで両方を実装するのと対応する、
 * ADR 0005・0003）。
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly observations = new Map<string, Observation>();
  private readonly memories = new Map<string, Memory>();
  /** `(tenant_id, source_observation_id, extractor_version, content_hash)` の冪等キー。 */
  private readonly extractionIndex = new Map<string, MemoryId>();
  /** `(tenant_id, recall_id, memory_id)` の使用報告の冪等キー。 */
  private readonly usages = new Set<string>();
  /** `InMemoryOutboxStore` と共有する outbox ジョブの配列（同一プロセス内の参照共有）。 */
  readonly outboxJobs: OutboxJobRecord[] = [];

  async createObservation(ctx: Ctx, input: NewObservation): Promise<Observation> {
    if (input.externalId) {
      const existing = [...this.observations.values()].find(
        (o) => o.tenantId === ctx.tenantId && o.externalId === input.externalId,
      );
      if (existing) {
        return existing;
      }
    }
    const observation: Observation = {
      id: nextId("obs"),
      tenantId: ctx.tenantId,
      subjectId: input.subjectId ?? null,
      externalId: input.externalId ?? null,
      kind: input.kind,
      payload: input.payload,
      occurredAt: input.occurredAt ?? null,
      recordedAt: input.recordedAt ?? new Date(),
    };
    this.observations.set(observation.id, observation);
    return observation;
  }

  async getObservation(ctx: Ctx, id: ObservationId): Promise<Observation | null> {
    const observation = this.observations.get(id);
    if (!observation || observation.tenantId !== ctx.tenantId) {
      return null;
    }
    return observation;
  }

  private enqueueOutboxJob(
    ctx: Ctx,
    kind: OutboxJobKind,
    payload: Record<string, unknown>,
  ): OutboxJobRecord {
    const job: OutboxJobRecord = {
      id: nextId("job"),
      tenantId: ctx.tenantId,
      kind,
      payload,
      availableAt: new Date(),
      claimedAt: null,
      claimedBy: null,
      attempts: 0,
      completedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: new Date(),
    };
    this.outboxJobs.push(job);
    return job;
  }

  async createObservationWithOutbox(
    ctx: Ctx,
    input: NewObservation,
    jobKinds: OutboxJobKind[],
  ): Promise<{ observation: Observation; created: boolean; jobs: OutboxJobRecord[] }> {
    const sizeBefore = this.observations.size;
    const observation = await this.createObservation(ctx, input);
    const created = this.observations.size > sizeBefore;
    if (!created) {
      return { observation, created: false, jobs: [] };
    }
    const jobs = jobKinds.map((kind) =>
      this.enqueueOutboxJob(ctx, kind, { observationId: observation.id }),
    );
    return { observation, created: true, jobs };
  }

  async createMemory(ctx: Ctx, input: NewMemory): Promise<Memory> {
    const idemKey = this.extractionKey(
      ctx.tenantId,
      input.sourceObservationId ?? null,
      input.extractorVersion ?? null,
      input.contentHash,
    );
    if (input.sourceObservationId) {
      const existingId = this.extractionIndex.get(idemKey);
      if (existingId) {
        const existing = this.memories.get(existingId);
        if (existing) {
          return existing;
        }
      }
    }

    const now = new Date();
    const memory: Memory = {
      id: nextId("mem"),
      tenantId: ctx.tenantId,
      subjectId: input.subjectId ?? null,
      sourceObservationId: input.sourceObservationId ?? null,
      extractorVersion: input.extractorVersion ?? null,
      content: input.content,
      contentHash: input.contentHash,
      digest: input.digest,
      digestSource: input.digestSource,
      provenance: input.provenance,
      status: input.status ?? "active",
      supersededById: input.supersededById ?? null,
      contestedWithId: input.contestedWithId ?? null,
      tags: input.tags,
      occurredAt: input.occurredAt ?? null,
      recordedAt: input.recordedAt,
      lastReinforcedAt: input.lastReinforcedAt ?? null,
      strength: input.strength,
      halfLifeHours: input.halfLifeHours,
      decayFloorAt: input.decayFloorAt,
      embeddingStatus: input.embeddingStatus,
      createdAt: now,
      updatedAt: now,
    };
    this.memories.set(memory.id, memory);
    if (input.sourceObservationId) {
      this.extractionIndex.set(idemKey, memory.id);
    }
    return memory;
  }

  async createMemoryWithOutbox(
    ctx: Ctx,
    input: NewMemory,
    jobKinds: OutboxJobKind[],
  ): Promise<{ memory: Memory; created: boolean; jobs: OutboxJobRecord[] }> {
    const sizeBefore = this.memories.size;
    const memory = await this.createMemory(ctx, input);
    const created = this.memories.size > sizeBefore;
    if (!created) {
      return { memory, created: false, jobs: [] };
    }
    const jobs = jobKinds.map((kind) => this.enqueueOutboxJob(ctx, kind, { memoryId: memory.id }));
    return { memory, created: true, jobs };
  }

  async get(ctx: Ctx, id: MemoryId): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory || memory.tenantId !== ctx.tenantId) {
      return null;
    }
    return memory;
  }

  async getMany(ctx: Ctx, ids: MemoryId[]): Promise<Memory[]> {
    const results: Memory[] = [];
    for (const id of ids) {
      const memory = this.memories.get(id);
      if (memory && memory.tenantId === ctx.tenantId) {
        results.push(memory);
      }
    }
    return results;
  }

  async updateStatus(
    ctx: Ctx,
    id: MemoryId,
    status: MemoryStatus,
    opts?: { supersededById?: MemoryId },
  ): Promise<Memory> {
    const memory = await this.get(ctx, id);
    if (!memory) {
      throw new Error(`InMemoryMemoryStore: memory not found for tenant: ${id}`);
    }
    memory.status = status;
    if (opts?.supersededById !== undefined) {
      memory.supersededById = opts.supersededById;
    }
    memory.updatedAt = new Date();
    return memory;
  }

  async setEmbeddingStatus(ctx: Ctx, id: MemoryId, status: EmbeddingStatus): Promise<Memory> {
    const memory = await this.get(ctx, id);
    if (!memory) {
      throw new Error(`InMemoryMemoryStore: memory not found for tenant: ${id}`);
    }
    memory.embeddingStatus = status;
    memory.updatedAt = new Date();
    return memory;
  }

  async reinforce(ctx: Ctx, id: MemoryId, at: Date): Promise<Memory> {
    const memory = await this.get(ctx, id);
    if (!memory) {
      throw new Error(`InMemoryMemoryStore: memory not found for tenant: ${id}`);
    }
    memory.lastReinforcedAt = at;
    memory.decayFloorAt = defaultDecayStrategy.floorAt({
      recordedAt: memory.recordedAt,
      lastReinforcedAt: memory.lastReinforcedAt,
      strength: memory.strength,
      halfLifeHours: memory.halfLifeHours,
    });
    memory.updatedAt = new Date();
    return memory;
  }

  async recordUsage(
    ctx: Ctx,
    recallId: RecallId,
    memoryIds: MemoryId[],
  ): Promise<{ insertedMemoryIds: MemoryId[] }> {
    const insertedMemoryIds: MemoryId[] = [];
    for (const memoryId of memoryIds) {
      const key = `${ctx.tenantId}:${recallId}:${memoryId}`;
      if (!this.usages.has(key)) {
        this.usages.add(key);
        insertedMemoryIds.push(memoryId);
      }
    }
    return { insertedMemoryIds };
  }

  async countByGroup(ctx: Ctx, scope: RecallScope): Promise<GroupCount[]> {
    const counts = new Map<string | null, number>();
    for (const memory of this.memories.values()) {
      if (memory.tenantId !== ctx.tenantId) {
        continue;
      }
      if (scope.subjectId !== undefined && memory.subjectId !== scope.subjectId) {
        continue;
      }
      if (scope.occurredAfter && memory.occurredAt && memory.occurredAt < scope.occurredAfter) {
        continue;
      }
      if (scope.occurredBefore && memory.occurredAt && memory.occurredAt > scope.occurredBefore) {
        continue;
      }
      const key = memory.subjectId ?? null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => ({
      axis: "subject" as const,
      key,
      count,
      countKind: "exact" as const,
    }));
  }

  private extractionKey(
    tenantId: string,
    sourceObservationId: string | null,
    extractorVersion: string | null,
    contentHash: string,
  ): string {
    return `${tenantId}:${sourceObservationId ?? ""}:${extractorVersion ?? ""}:${contentHash}`;
  }
}
