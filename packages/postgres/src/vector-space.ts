import type { Pool } from "pg";
import type { EmbeddingSpaceId } from "@mnemo/core";
import {
  assertSafeIdentifier,
  embeddingSpaceIndexName,
  embeddingSpaceTableName,
} from "./embedding-space-table.js";

/**
 * 埋め込み空間ごとのテーブル（`memory_embeddings_<space>`）を登録する
 * （docs/memory-model.md §10「決定: 埋め込み空間を登録する操作の一部として...テーブルを作る」）。
 *
 * `migrate.ts`（`migrations/*.sql`）とは別の口だが、同じ規約に従う——
 * **DDL はすべてこの関数の中に手書きで置き、drizzle-kit には一切頼らない**
 * （ADR 0001）。HNSW 索引の operator class もここで明示する。
 *
 * べき等: 既にテーブル・索引が存在する場合は何もしない（`IF NOT EXISTS`）。
 *
 * テーブル名・索引名は `EmbeddingSpaceId` から機械的に導出するため、呼び出し側が
 * 直接テーブル名を書く必要はない（`VectorStore` 実装がこの関数と同じ導出規則を使う）。
 */
export async function registerEmbeddingSpace(pool: Pool, space: EmbeddingSpaceId): Promise<void> {
  if (!Number.isInteger(space.dimensions) || space.dimensions <= 0) {
    throw new Error(`invalid embedding space dimensions: ${space.dimensions}`);
  }

  const table = embeddingSpaceTableName(space);
  const index = embeddingSpaceIndexName(space);
  assertSafeIdentifier(table);
  assertSafeIdentifier(index);

  // dimensions は上で正整数であることを確認済みなので、そのまま埋め込んでよい
  // （パラメータ化できない — vector(N) の N は SQL の識別子/型修飾子の位置にある）。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      tenant_id   text         NOT NULL,
      memory_id   uuid         NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      embedding   vector(${space.dimensions}) NOT NULL,
      model       text         NOT NULL,
      created_at  timestamptz  NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, memory_id)
    );
  `);

  // HNSW 索引。operator class を明示する（cosine 距離を採用する。
  // docs/memory-model.md §10 の例と同じ形）。
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${index}
      ON ${table}
      USING hnsw (embedding vector_cosine_ops);
  `);
}
