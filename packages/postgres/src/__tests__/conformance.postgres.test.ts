import { afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { Ctx } from "@mnemo/core";
import {
  describeEventStoreConformance,
  describeMemoryStoreConformance,
  describeVectorStoreConformance,
} from "@mnemo/testkit";
import { buildNewMemoryFixture } from "@mnemo/testkit";
import { PostgresMemoryStore } from "../memory-store.js";
import { PostgresVectorStore } from "../vector-store.js";
import { PostgresEventStore } from "../event-store.js";
import { closeTestClient, getTestClient, resetTestDatabase } from "./test-db.js";

/**
 * `packages/testkit` の適合テストを、本物の Postgres 実装に対して実行する
 * （roadmap.md 段階2の完了条件: 「testkit の適合テストが postgres 実装に対してすべて通る」）。
 *
 * 擬似物（in-memory）ではなく実際に繋がっていることは、`docs/decisions/0001-orm-drizzle.md`
 * が要求する外部キー・一意制約・partial index が実際に効くかどうかで検証される
 * （in-memory 実装は制約を一切模していないため、この種の不整合はここでしか見つからない）。
 */

describeMemoryStoreConformance({
  name: "postgres",
  createStore: async () => {
    await resetTestDatabase();
    const { db } = await getTestClient();
    return new PostgresMemoryStore(db);
  },
  prepareRecallId: async (ctx: Ctx) => {
    const { db } = await getTestClient();
    const result = await db.execute(sql`
      INSERT INTO recalls (id, tenant_id, query, usage, index_band)
      VALUES (gen_random_uuid(), ${ctx.tenantId}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
      RETURNING id
    `);
    return (result.rows[0] as unknown as { id: string }).id;
  },
});

describeEventStoreConformance({
  name: "postgres",
  createStore: async () => {
    await resetTestDatabase();
    const { db } = await getTestClient();
    return new PostgresEventStore(db);
  },
  prepareMemoryId: async (ctx: Ctx) => {
    const { db } = await getTestClient();
    const store = new PostgresMemoryStore(db);
    const memory = await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: ctx.tenantId }));
    return memory.id;
  },
});

describeVectorStoreConformance({
  name: "postgres",
  createStore: async () => {
    await resetTestDatabase();
    const { db } = await getTestClient();
    return new PostgresVectorStore(db);
  },
  prepareMemoryId: async (ctx: Ctx) => {
    const { db } = await getTestClient();
    const store = new PostgresMemoryStore(db);
    const memory = await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: ctx.tenantId }));
    return memory.id;
  },
});

afterAll(async () => {
  await closeTestClient();
});
