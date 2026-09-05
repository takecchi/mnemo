import type { Runtime } from "@mnemora/core";
import { createRuntime } from "@mnemora/core";
import {
  PostgresEventStore,
  PostgresMemoryStore,
  PostgresOutboxStore,
  PostgresTenantSettingsStore,
  PostgresVectorStore,
  closePostgresClient,
  createPostgresClient,
  registerEmbeddingSpace,
  runMigrations,
  sha256Hex,
} from "@mnemora/postgres";
import type { EnvLike, ProviderMode } from "./providers.js";
import { createProviders } from "./providers.js";

export interface ExampleRuntimeHandle {
  runtime: Runtime;
  mode: ProviderMode;
  close(): Promise<void>;
}

/**
 * サンプルアプリの `Runtime` を組み立てる（roadmap.md 段階7）。
 *
 * - `packages/postgres` に対してマイグレーションと埋め込み空間登録を行う。
 *   `runMigrations`（ADR 0017）・`registerEmbeddingSpace`（ADR 0018）は**どちらも**
 *   advisory lock でプロセス間排他される——複数のレプリカが同時にこの関数を呼んでも安全。
 *   **「`IF NOT EXISTS` 系だから安全」ではない**（段階1の実測で、`CREATE TABLE
 *   IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` はいずれも並行では非アトミックで、
 *   複数プロセスが同時に呼ぶと決定的にどちらか一方が落ちることを確認済み。
 *   `runMigrations` は ADR 0017、`registerEmbeddingSpace` は ADR 0018 を参照）。
 *   2つの関数は別々の advisory lock キーを使う（`MIGRATION_LOCK_KEY` /
 *   `REGISTER_EMBEDDING_SPACE_LOCK_KEY`）ため、互いをブロックしない。
 * - `packages/testkit` の擬似 provider か、本物の `packages/openai` かは
 *   `createProviders`（`OPENAI_API_KEY` の有無）が決める。
 */
export async function createExampleRuntime(
  databaseUrl: string,
  env: EnvLike = process.env,
): Promise<ExampleRuntimeHandle> {
  const client = createPostgresClient(databaseUrl);
  await runMigrations(client.pool);

  const { llmProvider, embeddingProvider, mode } = createProviders(env);
  await registerEmbeddingSpace(client.pool, embeddingProvider.space);

  const runtime = createRuntime({
    memoryStore: new PostgresMemoryStore(client.db),
    outboxStore: new PostgresOutboxStore(client.db),
    vectorStore: new PostgresVectorStore(client.db),
    eventStore: new PostgresEventStore(client.db),
    tenantSettingsStore: new PostgresTenantSettingsStore(client.db),
    llmProvider,
    embeddingProvider,
    hashContent: sha256Hex,
  });

  return {
    runtime,
    mode,
    close: () => closePostgresClient(client),
  };
}
