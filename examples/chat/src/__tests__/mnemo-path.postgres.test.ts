import { afterAll, describe, expect, it } from "vitest";
import type { Ctx } from "@mnemo/core";
import { buildConversation } from "../scenario.js";
import { ingestConversation, queryRecall } from "../mnemo-path.js";
import { createExampleRuntime } from "../runtime-factory.js";
import {
  closeTestClient,
  getTestClient,
  requireDatabaseUrl,
  resetTestDatabase,
} from "./test-db.js";

/**
 * roadmap.md 段階7の完了条件「サンプルアプリが observe → recall の往復を実演し、
 * omitted と usage を画面またはログに可視化する」を、本物の Postgres に対して実際に
 * 検査する（PR 本文「サンプルアプリ自体が壊れていないことを CI で検査する」）。
 *
 * provider は `@mnemo/testkit` の決定的な擬似実装（`createExampleRuntime` に
 * `env: {}` を渡し、`OPENAI_API_KEY` の有無に関わらず deterministic モードを強制する）。
 * DB は擬似物で代替しない——本物の Postgres + pgvector に対して実行する。
 */
describe("examples/chat: observe → recall の往復（本物の Postgres）", () => {
  it("ingestConversation → queryRecall(budget 無し) は memories/omitted/usage/index を返す", async () => {
    await resetTestDatabase();
    await getTestClient(); // マイグレーション・埋め込み空間登録を先に済ませておく
    const handle = await createExampleRuntime(requireDatabaseUrl(), {});
    try {
      expect(handle.mode).toBe("deterministic");
      const ctx: Ctx = { tenantId: "example-chat-roundtrip" };
      const conversation = buildConversation(3);

      await ingestConversation(handle.runtime, ctx, conversation);
      const result = await queryRecall(handle.runtime, ctx, conversation);

      expect(result.memories.length).toBeGreaterThan(0);
      expect(Array.isArray(result.omitted)).toBe(true);
      expect(result.usage.chars).toBeGreaterThan(0);
      expect(result.usage.counter).toBe("heuristic");
      expect(result.index.totalInScope).toBe(conversation.userUtterances.length);
      // budget を渡していないので、切り詰めによる omission は発生しない。
      expect(result.omitted.some((o) => o.kind === "budget_dropped")).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it("ingestConversation → queryRecall(budget 有り) は実際に候補を切り詰め、budget_dropped を報告する", async () => {
    await resetTestDatabase();
    await getTestClient();
    const handle = await createExampleRuntime(requireDatabaseUrl(), {});
    try {
      const ctx: Ctx = { tenantId: "example-chat-roundtrip-budget" };
      // fillerPairs=10 なら user 発話が11件——既定の limit(10) 全件が返る量があるはずで、
      // 小さな budget で確実に切り詰めが起きる。
      const conversation = buildConversation(10);

      await ingestConversation(handle.runtime, ctx, conversation);
      const withoutBudget = await queryRecall(handle.runtime, ctx, conversation);
      const withBudget = await queryRecall(handle.runtime, ctx, conversation, {
        budget: { maxChars: 40 },
      });

      const dropped = withBudget.omitted.find((o) => o.kind === "budget_dropped");
      expect(dropped).toBeDefined();
      expect(dropped && dropped.kind === "budget_dropped" && dropped.count).toBeGreaterThan(0);
      // budget を渡した方が、渡さなかった場合より返る memories が少ない
      // （同じ入力・同じ ctx に対して、budget の有無だけを変えて比較している——
      // 「同じ値を両辺で使う比較」にならないよう、実行結果を毎回独立に取り直している）。
      expect(withBudget.memories.length).toBeLessThan(withoutBudget.memories.length);
    } finally {
      await handle.close();
    }
  });
});

afterAll(async () => {
  await closeTestClient();
});
