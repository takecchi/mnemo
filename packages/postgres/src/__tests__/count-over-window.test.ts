import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@mnemora/core";
import { buildNewMemoryFixture } from "@mnemora/testkit";
import { PostgresMemoryStore } from "../memory-store.js";
import { PostgresVectorStore } from "../vector-store.js";
import { embeddingSpaceTableName } from "../embedding-space-table.js";
import {
  closeTestClient,
  getTestClient,
  resetTestDatabase,
  TEST_EMBEDDING_SPACE,
  seededRandom,
} from "./test-db.js";

/**
 * ADR 0011 の実測根拠を歯にする。
 *
 * `docs/recall.md` §3 の原案は段1のクエリに `count(*) OVER ()` を含め、これで
 * 「フィルタ条件下で候補が何件あったか」を追加クエリ無しに正確に取れる、としていた。
 * マネージャーが実測したところ、これは PostgreSQL 18.6 + pgvector 0.8.6 の HNSW 上では
 * 成立しない（`docs/decisions/0011-no-window-count-in-ann-stage.md` 参照）。
 * このテストはその事実そのものを検査する——ADR の主張が将来ひとりでに腐らないための歯。
 *
 * 二つの分岐:
 * - 分岐B（既定のプランナ挙動）: `count(*) OVER ()` を入れると HNSW が捨てられ、
 *   Seq Scan + WindowAgg に落ちる（件数は正しいが索引を殺す）。
 * - 分岐A（`enable_seqscan = off` で索引を強制した場合）: 返る件数は真の総件数ではなく、
 *   ANN の探索設定（`hnsw.ef_search`）に依存する値に固定される。データ件数を変えても
 *   ほぼ変わらないことまで確認し、「データと無関係な値」であることをデータで示す。
 */

const TENANT = "count-over-window-tenant";
const TABLE = embeddingSpaceTableName(TEST_EMBEDDING_SPACE);

async function seed(
  memoryStore: PostgresMemoryStore,
  vectorStore: PostgresVectorStore,
  ctx: Ctx,
  count: number,
  pool: Pool,
) {
  const rand = seededRandom(20260905);
  for (let i = 0; i < count; i += 1) {
    const memory = await memoryStore.createMemory(
      ctx,
      buildNewMemoryFixture({ tenantId: ctx.tenantId }),
    );
    await vectorStore.upsert(ctx, TEST_EMBEDDING_SPACE, memory.id, [rand(), rand(), rand()]);
  }
  // 統計情報が無いと、プランナが誤った行数見積もりで意図しない索引を選んでしまう。
  await pool.query(`ANALYZE ${TABLE}`);
  await pool.query("ANALYZE memories");
}

/**
 * `enable_seqscan = off` で索引を強制した状態で、ANN の全走査結果を件数だけ数える。
 * 別接続・別トランザクションで実行し、`ROLLBACK` で設定変更を後に残さない。
 *
 * **意図的に `WHERE tenant_id = ...` を付けない。** 実測したところ、`tenant_id` で
 * 絞る形にすると、`memory_embeddings_<space>` の主キー `(tenant_id, memory_id)` が
 * 別の非 Seq Scan 経路（Bitmap Index Scan + 明示的な Sort、常に正確な件数を返す）を
 * 提供してしまい、`enable_seqscan = off` だけでは HNSW を強制できない
 * （プランナはこの経路の方が安いと判断し続ける）。この分岐Aは「HNSW 索引そのものが
 * 持つ、探索設定に依存した打ち切り」という一般的な性質の実測であり、
 * マネージャーの実測（`WHERE` 無しの `t_big` に対する検証）と同じ形にしている。
 * 分岐B（下のテスト）は実際の `PostgresVectorStore.search` と同じ `tenant_id` 付きの
 * クエリで検証しており、そちらが本PRの実装に直結する検査である。
 */
async function countWithSeqScanDisabled(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    await client.query("SET LOCAL hnsw.ef_search = 40");
    const result = await client.query(
      `SELECT count(*) AS candidate_count FROM (
         SELECT memory_id FROM ${TABLE}
         ORDER BY embedding <=> '[0.5,0.5,0.5]'::vector
       ) s`,
    );
    return Number(result.rows[0].candidate_count);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("count(*) OVER () は HNSW 上で成立しない（ADR 0011）", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestClient();
  });

  it("分岐B: count(*) OVER () を含めると、既定のプランナは HNSW を捨てて Seq Scan + WindowAgg を選ぶ", async () => {
    const { db, pool } = await getTestClient();
    const memoryStore = new PostgresMemoryStore(db);
    const vectorStore = new PostgresVectorStore(db);
    const ctx: Ctx = { tenantId: TENANT };
    const rowCount = 3000;
    await seed(memoryStore, vectorStore, ctx, rowCount, pool);

    // count(*) OVER () を含めない場合: HNSW 索引を使う。
    const withoutWindow = await pool.query(
      `EXPLAIN (FORMAT TEXT)
       SELECT memory_id, embedding <=> '[0.5,0.5,0.5]'::vector AS distance
       FROM ${TABLE}
       WHERE tenant_id = $1
       ORDER BY embedding <=> '[0.5,0.5,0.5]'::vector
       LIMIT 10`,
      [TENANT],
    );
    const planWithoutWindow = withoutWindow.rows
      .map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"])
      .join("\n");
    expect(planWithoutWindow).toMatch(/Index Scan.*using idx_memory_embeddings_hnsw/);

    // count(*) OVER () を含めると、同じ ORDER BY / LIMIT でも Seq Scan + WindowAgg に変わる。
    const withWindow = await pool.query(
      `EXPLAIN (FORMAT TEXT)
       SELECT memory_id,
              embedding <=> '[0.5,0.5,0.5]'::vector AS distance,
              count(*) OVER () AS candidate_count
       FROM ${TABLE}
       WHERE tenant_id = $1
       ORDER BY embedding <=> '[0.5,0.5,0.5]'::vector
       LIMIT 10`,
      [TENANT],
    );
    const planWithWindow = withWindow.rows
      .map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"])
      .join("\n");
    expect(planWithWindow).toMatch(/Seq Scan/);
    expect(planWithWindow).toMatch(/WindowAgg/);
    expect(planWithWindow).not.toMatch(/Index Scan.*using idx_memory_embeddings_hnsw/);

    // 索引を捨てた代償として、この分岐でだけ candidate_count は真の総件数と一致する。
    const rows = await pool.query(
      `SELECT count(*) OVER () AS candidate_count
       FROM ${TABLE}
       WHERE tenant_id = $1
       ORDER BY embedding <=> '[0.5,0.5,0.5]'::vector
       LIMIT 10`,
      [TENANT],
    );
    expect(Number(rows.rows[0].candidate_count)).toBe(rowCount);
  }, 120_000);

  it("分岐A: 索引を強制すると、返る件数は真の総件数ではなく ANN の探索設定に固定される", async () => {
    const { db, pool } = await getTestClient();
    const memoryStore = new PostgresMemoryStore(db);
    const vectorStore = new PostgresVectorStore(db);
    const ctx: Ctx = { tenantId: TENANT };

    const smallCount = 3000;
    await seed(memoryStore, vectorStore, ctx, smallCount, pool);
    const smallCapped = await countWithSeqScanDisabled(pool);
    // 真のデータ件数と一致しない（打ち切りが起きている）。
    expect(smallCapped).toBeLessThan(smallCount);

    await resetTestDatabase();
    const largeCount = 9000;
    await seed(memoryStore, vectorStore, ctx, largeCount, pool);
    const largeCapped = await countWithSeqScanDisabled(pool);
    expect(largeCapped).toBeLessThan(largeCount);

    // データ件数が 3000 -> 9000 (3倍) に増えても、同じ hnsw.ef_search なら
    // 打ち切り件数はほぼ変わらない——つまりこの数値は「データが何件あったか」を
    // 表していない、という ADR 0011 の核心を検査する。
    // 環境差を吸収するため、「3倍のデータ件数の差ほどは動かない」という緩い比較にする。
    const ratio = largeCapped / smallCapped;
    expect(ratio).toBeLessThan(2);
  }, 120_000);
});
