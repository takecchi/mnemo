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
 *   `runMigrations` は advisory lock でプロセス間排他される（ADR 0017）ため、複数の
 *   レプリカが同時にこの関数を呼んでも安全——**「`IF NOT EXISTS` 系だから安全」ではない**
 *   （段階1の実測で `0001_init.sql` の無印 `CREATE TABLE` に加え、`CREATE TABLE
 *   IF NOT EXISTS` 自体も並行では非アトミックなことを確認済み。ADR 0017 参照）。
 *   一方 `registerEmbeddingSpace` はまだこの排他の対象外——**複数レプリカが同時に
 *   起動する経路では、この呼び出しが次の衝突点として残っている**（ADR 0017 の
 *   「残った課題」）。
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
