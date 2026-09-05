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

  /**
   * ⭐ 北極星の物差しに直接効く歯。
   *
   * `compare` が示す「642ターンで naive の 1.9%」という削減率は、**それだけでは意味を持たない。**
   * 何も返さなければ削減率は 0% になる。削減が意味を持つのは、
   * **呼び出し側が探している答えが、削られた後にも残っている**場合だけである。
   * ——「使う側が、会話ログを全部プロンプトへ積むのをやめられたか」という物差しは、
   * 積むのをやめても答えが得られることを含意している。
   *
   * この歯は、会話が長くなって `recall()` が既定 `limit` で大幅に絞り込むようになっても、
   * 冒頭で一度だけ表明された事実（`FACT_STATEMENT`）が返り値に残ることを検査する。
   *
   * **⚠ この歯が主張しないこと**: 擬似 embedding は意味的な類似度を持たないため、
   * これは「意味的に関連する記憶が正しく上位に来る」ことの証明ではない。
   * 主張しているのは、**この決定的なシナリオにおいて、量を1桁以上削っても
   * 目的の記憶が落ちない**ということだけである（README「この実測の限界」参照）。
   */
  it("会話が長くなって大幅に絞り込まれても、冒頭で表明された事実は返り値に残る", async () => {
    await resetTestDatabase();
    await getTestClient();
    const handle = await createExampleRuntime(requireDatabaseUrl(), {});
    try {
      const ctx: Ctx = { tenantId: "example-chat-fact-survives" };
      // filler 80組 = 162ターン。user 発話 81件に対し、既定 limit は 10 件。
      const conversation = buildConversation(80);
      await ingestConversation(handle.runtime, ctx, conversation);
      const result = await queryRecall(handle.runtime, ctx, conversation);

      // 前提: 実際に大幅な絞り込みが起きていること。
      // （絞り込みが起きていなければ「残った」ことに意味が無い——
      //   この2行が無いと、limit が緩んだ瞬間にこの歯は無意味な緑になる。）
      expect(result.index.totalInScope).toBe(conversation.userUtterances.length);
      expect(result.memories.length).toBeLessThan(result.index.totalInScope / 4);

      // 本題: 絞り込まれた後にも、冒頭の事実が残っている。
      const digests = result.memories.map((m) => m.digest);
      expect(digests.some((d) => d.includes("青"))).toBe(true);
    } finally {
      await handle.close();
    }
  });
});

afterAll(async () => {
  await closeTestClient();
});
