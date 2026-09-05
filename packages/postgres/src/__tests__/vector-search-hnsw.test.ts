import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@mnemo/core";
import { buildNewMemoryFixture } from "@mnemo/testkit";
import { PostgresMemoryStore } from "../memory-store.js";
import { PostgresVectorStore } from "../vector-store.js";
import { embeddingSpaceTableName } from "../embedding-space-table.js";
import {
  closeTestClient,
  getTestClient,
  resetTestDatabase,
  TEST_EMBEDDING_SPACE,
} from "./test-db.js";

const TABLE = embeddingSpaceTableName(TEST_EMBEDDING_SPACE);

/**
 * roadmap.md 段階2の完了条件そのもの:
 * 「ベクトル索引を使う ORDER BY について、EXPLAIN で実際に HNSW 索引が使われることを
 *   確認する検査が通る」
 *
 * `PostgresVectorStore.search` が生成するのと同じ形（`ORDER BY` に距離演算子の結果を
 * そのまま昇順で置く）のクエリを EXPLAIN し、実際に `idx_memory_embeddings_hnsw_*` が
 * 使われることを検査する。docs/memory-model.md §10「規約」・ADR 0001 が禁じる
 * 「式にした ORDER BY」（`1 - cosineDistance(...)` 等）を書いていないことの実地証明。
 */

const TENANT = "hnsw-tenant";
const ROW_COUNT = 3000;

async function seed(
  memoryStore: PostgresMemoryStore,
  vectorStore: PostgresVectorStore,
  ctx: Ctx,
  pool: Pool,
) {
  for (let i = 0; i < ROW_COUNT; i += 1) {
    const memory = await memoryStore.createMemory(
      ctx,
      buildNewMemoryFixture({ tenantId: ctx.tenantId }),
    );
    const vector = [Math.random(), Math.random(), Math.random()];
    await vectorStore.upsert(ctx, TEST_EMBEDDING_SPACE, memory.id, vector);
  }
  // 統計情報が無い/古いままだと、プランナが誤った行数見積もりで意図しない索引を選ぶ
  // （実測: ANALYZE 無しでは主キー索引が選ばれ、HNSW 索引が選ばれなかった）。
  await pool.query(`ANALYZE ${TABLE}`);
  await pool.query("ANALYZE memories");
}

describe("PostgresVectorStore.search と HNSW 索引", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestClient();
  });

  it("ORDER BY <=> ... LIMIT の形で EXPLAIN すると HNSW 索引が使われる（再現用の等価クエリ）", async () => {
    const { db, pool } = await getTestClient();
    const memoryStore = new PostgresMemoryStore(db);
    const vectorStore = new PostgresVectorStore(db);
    const ctx: Ctx = { tenantId: TENANT };
    await seed(memoryStore, vectorStore, ctx, pool);

    const explainResult = await pool.query(
      `EXPLAIN (FORMAT TEXT)
       SELECT memory_id, embedding <=> '[0.5,0.5,0.5]'::vector AS distance
       FROM ${TABLE}
       WHERE tenant_id = $1
       ORDER BY embedding <=> '[0.5,0.5,0.5]'::vector
       LIMIT 10`,
      [TENANT],
    );
    const plan = explainResult.rows
      .map((row: { "QUERY PLAN": string }) => row["QUERY PLAN"])
      .join("\n");
    expect(plan).toMatch(/Index Scan.*using idx_memory_embeddings_hnsw/);
    expect(plan).not.toMatch(/Seq Scan/);
  }, 60_000);

  it("PostgresVectorStore.search が実際に発行するクエリ自体が EXPLAIN で HNSW 索引を使う", async () => {
    // 上のテストは「同じ形のクエリなら索引が使われる」ことしか確認しない。
    // ここでは vectorStore.search() が実際に組み立てる SQL 文字列とパラメータを捕捉し、
    // それをそのまま EXPLAIN する——`ORDER BY` を式にする回帰（例: `1 - (embedding <=> ...)`
    // のような書き換え）が入ったら、このテストだけが検出できる。
    const { db, pool } = await getTestClient();
    const memoryStore = new PostgresMemoryStore(db);
    const vectorStore = new PostgresVectorStore(db);
    const ctx: Ctx = { tenantId: TENANT };
    await seed(memoryStore, vectorStore, ctx, pool);

    let capturedText: string | undefined;
    let capturedParams: unknown[] | undefined;
    const originalQuery = pool.query.bind(pool);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool as any).query = (...args: unknown[]) => {
      const [config, params] = args as [string | { text: string }, unknown[] | undefined];
      const text = typeof config === "string" ? config : config.text;
      if (text.includes(TABLE) && /order by/i.test(text)) {
        capturedText = text;
        capturedParams = params;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalQuery as any)(...args);
    };

    try {
      await vectorStore.search(ctx, TEST_EMBEDDING_SPACE, [0.5, 0.5, 0.5], {
        limit: 10,
        filter: { tenantId: TENANT },
      });
    } finally {
      pool.query = originalQuery;
    }

    expect(capturedText).toBeDefined();
    const explainResult = await pool.query(`EXPLAIN (FORMAT TEXT) ${capturedText}`, capturedParams);
    const plan = explainResult.rows
      .map((row: { "QUERY PLAN": string }) => row["QUERY PLAN"])
      .join("\n");
    expect(plan).toMatch(/Index Scan.*using idx_memory_embeddings_hnsw/);
    expect(plan).not.toMatch(/Seq Scan/);
  }, 60_000);

  it("search() は実際に limit 件以内のヒットを距離昇順で返す（機能としての往復確認）", async () => {
    const { db, pool } = await getTestClient();
    const memoryStore = new PostgresMemoryStore(db);
    const vectorStore = new PostgresVectorStore(db);
    const ctx: Ctx = { tenantId: TENANT };
    await seed(memoryStore, vectorStore, ctx, pool);

    const hits = await vectorStore.search(ctx, TEST_EMBEDDING_SPACE, [0.5, 0.5, 0.5], {
      limit: 10,
      filter: { tenantId: TENANT },
    });
    expect(hits.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i]!.distance).toBeGreaterThanOrEqual(hits[i - 1]!.distance);
    }
  }, 60_000);

  it("filter.status で絞り込むと、対象外の status の Memory は search に現れない", async () => {
    const { db } = await getTestClient();
    const memoryStore = new PostgresMemoryStore(db);
    const vectorStore = new PostgresVectorStore(db);
    const ctx: Ctx = { tenantId: TENANT };

    const activeMemory = await memoryStore.createMemory(
      ctx,
      buildNewMemoryFixture({ tenantId: TENANT, status: "active" }),
    );
    const supersededMemory = await memoryStore.createMemory(
      ctx,
      buildNewMemoryFixture({ tenantId: TENANT, status: "superseded" }),
    );
    await vectorStore.upsert(ctx, TEST_EMBEDDING_SPACE, activeMemory.id, [1, 0, 0]);
    await vectorStore.upsert(ctx, TEST_EMBEDDING_SPACE, supersededMemory.id, [1, 0, 0]);

    const hits = await vectorStore.search(ctx, TEST_EMBEDDING_SPACE, [1, 0, 0], {
      limit: 10,
      filter: { tenantId: TENANT, status: ["active"] },
    });
    const hitIds = hits.map((hit) => hit.memoryId);
    expect(hitIds).toContain(activeMemory.id);
    expect(hitIds).not.toContain(supersededMemory.id);
  });

  it("filter.decayFloorAtAfter で絞り込める", async () => {
    const { db } = await getTestClient();
    const memoryStore = new PostgresMemoryStore(db);
    const vectorStore = new PostgresVectorStore(db);
    const ctx: Ctx = { tenantId: TENANT };

    const farFuture = new Date("2099-01-01T00:00:00.000Z");
    const past = new Date("2000-01-01T00:00:00.000Z");

    const freshMemory = await memoryStore.createMemory(
      ctx,
      buildNewMemoryFixture({ tenantId: TENANT, decayFloorAt: farFuture }),
    );
    const staleMemory = await memoryStore.createMemory(
      ctx,
      buildNewMemoryFixture({ tenantId: TENANT, decayFloorAt: past }),
    );
    await vectorStore.upsert(ctx, TEST_EMBEDDING_SPACE, freshMemory.id, [1, 0, 0]);
    await vectorStore.upsert(ctx, TEST_EMBEDDING_SPACE, staleMemory.id, [1, 0, 0]);

    const hits = await vectorStore.search(ctx, TEST_EMBEDDING_SPACE, [1, 0, 0], {
      limit: 10,
      filter: { tenantId: TENANT, decayFloorAtAfter: new Date("2050-01-01T00:00:00.000Z") },
    });
    const hitIds = hits.map((hit) => hit.memoryId);
    expect(hitIds).toContain(freshMemory.id);
    expect(hitIds).not.toContain(staleMemory.id);
  });
});
