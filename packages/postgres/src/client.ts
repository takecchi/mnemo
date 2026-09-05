import { Pool, type PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export interface PostgresClient {
  pool: Pool;
  db: Db;
}

/**
 * `MemoryStore` / `VectorStore` / `EventStore` を1接続で実装するための唯一の入口
 * （ADR 0001・ADR 0003: リファレンス実装は同一 DB・同一トランザクション）。
 */
export function createPostgresClient(
  connectionString: string,
  config?: PoolConfig,
): PostgresClient {
  const pool = new Pool({ connectionString, ...config });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export async function closePostgresClient(client: PostgresClient): Promise<void> {
  await client.pool.end();
}
