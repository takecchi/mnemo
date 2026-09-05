import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx, MemoryStatus } from "@mnemora/core";
import { defaultDecayStrategy } from "@mnemora/core";
import { buildNewMemoryFixture } from "@mnemora/testkit";
import { PostgresMemoryStore } from "../memory-store.js";
import { closeTestClient, getTestClient, resetTestDatabase } from "./test-db.js";

/**
 * 誤り1の修正の検査（マネージャー指摘）:
 *
 * `docs/memory-model.md` §10 の原案は `idx_memories_recall_gate` の述語を
 * `WHERE status = 'active'` としていたが、これでは `contested` な Memory が段1の
 * 候補集合にそもそも入らず、「争われている主張を、争われていない顔で出さない」
 * （mandatory companion retrieval、docs/memory-model.md §5・docs/recall.md §8）が
 * 実装として成立しない。本PRで述語を `WHERE status IN ('active', 'contested')` に
 * 修正した（`migrations/0001_init.sql`）。
 *
 * このテストは二つを検査する:
 * 1. 修正後の述語でも `idx_memories_recall_gate` が実際に `EXPLAIN` 上で使われること。
 * 2. `contested` な Memory が実際にこのクエリの結果集合に現れること（索引の話とデータの話、
 *    両方を検査しないと「索引はあるが述語を書き間違えて何も拾えていない」を見逃す）。
 */

const TENANT = "recall-gate-tenant";
// btree の partial index をシーケンシャルスキャンより優先させるため、行数を多めに用意する。
const ROW_COUNT = 4000;

async function insertManyMemories(
  store: PostgresMemoryStore,
  ctx: Ctx,
  statuses: MemoryStatus[],
  pool: Pool,
) {
  for (let i = 0; i < ROW_COUNT; i += 1) {
    const status = statuses[i % statuses.length]!;
    await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: ctx.tenantId, status }));
  }
  // 統計情報が無いと、プランナが誤った行数見積もりで無関係な索引を選んでしまう
  // （実測: ANALYZE 無しでは idx_memories_provenance_kind が選ばれることがあった）。
  await pool.query("ANALYZE memories");
}

describe("idx_memories_recall_gate (誤り1の修正)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestClient();
  });

  it("修正後の述語 (status IN ('active','contested')) でも索引が使われ、contested な Memory も候補に含まれる", async () => {
    const { db, pool } = await getTestClient();
    const store = new PostgresMemoryStore(db);
    const ctx: Ctx = { tenantId: TENANT };

    await insertManyMemories(
      store,
      ctx,
      ["active", "contested", "superseded", "archived", "forgotten"],
      pool,
    );

    const explainResult = await pool.query(
      `EXPLAIN (FORMAT TEXT)
       SELECT id, status FROM memories
       WHERE tenant_id = $1 AND status = ANY($2::text[]) AND decay_floor_at > now() - interval '1000 days'
       ORDER BY decay_floor_at
       LIMIT 50`,
      [TENANT, ["active", "contested"]],
    );
    const plan = explainResult.rows
      .map((row: { "QUERY PLAN": string }) => row["QUERY PLAN"])
      .join("\n");
    expect(plan).toContain("idx_memories_recall_gate");
    expect(plan).not.toMatch(/Seq Scan on memories/);

    const dataResult = await pool.query(
      `SELECT status FROM memories
       WHERE tenant_id = $1 AND status = ANY($2::text[])`,
      [TENANT, ["active", "contested"]],
    );
    const statusesReturned = new Set(dataResult.rows.map((row: { status: string }) => row.status));
    expect(statusesReturned.has("active")).toBe(true);
    expect(statusesReturned.has("contested")).toBe(true);
    expect(statusesReturned.has("superseded")).toBe(false);
    expect(statusesReturned.has("archived")).toBe(false);
    expect(statusesReturned.has("forgotten")).toBe(false);
  }, 60_000);

  it("decay_floor_at は Phase 1 では読み取りフィルタに使わない（roadmap.md、誤り3の整理）が、索引の3列目としては持つ", async () => {
    // Phase 1 は decay_floor_at を書き込むだけで、段1の WHERE には使わない
    // （roadmap.md「Phase 2 で WHERE decay_floor_at > now() を使い始めるだけ」）。
    // ここでは「書き込み時に decay_floor_at が計算されている」ことと、索引が
    // (tenant_id, status, decay_floor_at) の3列構成であることをスキーマ側で確認する。
    const { pool } = await getTestClient();
    const indexDef = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_memories_recall_gate'`,
    );
    expect(indexDef.rows[0]?.indexdef).toContain("decay_floor_at");
    expect(indexDef.rows[0]?.indexdef).toContain("tenant_id");
    expect(indexDef.rows[0]?.indexdef).toContain("status");

    const ctx: Ctx = { tenantId: TENANT };
    const { db } = await getTestClient();
    const store = new PostgresMemoryStore(db);
    const memory = await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: TENANT }));
    const expected = defaultDecayStrategy.floorAt({
      recordedAt: memory.recordedAt,
      lastReinforcedAt: null,
      strength: memory.strength,
      halfLifeHours: memory.halfLifeHours,
    });
    expect(memory.decayFloorAt.getTime()).toBe(expected.getTime());
  });
});
