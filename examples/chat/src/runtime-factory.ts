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
 * - `packages/postgres` に対してマイグレーションと埋め込み空間登録を行う。冪等
 *   （`runMigrations`/`registerEmbeddingSpace` はどちらも `IF NOT EXISTS` 系）なので、
 *   既に整備済みの DB に対して呼んでも安全。
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
