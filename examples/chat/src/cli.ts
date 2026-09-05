#!/usr/bin/env node
import { heuristicTokenCounter } from "@mnemo/core";
import { formatComparisonTable, runComparison } from "./compare.js";
import { formatRecall } from "./format.js";
import { buildMnemoPrompt, ingestConversation, queryRecall } from "./mnemo-path.js";
import { measureNaive, naivePrompt } from "./naive-path.js";
import { createExampleRuntime } from "./runtime-factory.js";
import { buildConversation } from "./scenario.js";

/** `chat` サブコマンドで使う会話の長さ(filler 往復数)。サンプルアプリの裁量値。 */
const DEFAULT_CHAT_FILLER_PAIRS = 8;
/** budget が実際に切り詰めることを見せるための、意図的に小さい文字数予算。 */
const TINY_BUDGET_CHARS = 60;
/** `compare` サブコマンドで測る会話の長さ(filler 往復数)の既定の列。 */
const DEFAULT_COMPARE_SEQUENCE = [0, 1, 2, 3, 4, 5, 10, 20, 40, 80, 160, 320];

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL が設定されていません。mnemo は Postgres + pgvector を要求する " +
        "（docs/roadmap.md 段階2）。examples/chat/README.md の手順でローカル DB を用意し、" +
        "DATABASE_URL を設定してから実行すること。",
    );
  }
  return url;
}

function printProviderMode(mode: "openai" | "deterministic"): void {
  if (mode === "openai") {
    console.log(
      "[provider] OPENAI_API_KEY を検出しました。本物の OpenAI (LLM/Embedding) で動いています。",
    );
  } else {
    console.log(
      "[provider] OPENAI_API_KEY が無いため、@mnemo/testkit の決定的な擬似 provider で動いています。" +
        "擬似 embedding は意味的な類似度を表現しないため、このモードでは recall の関連度そのものは" +
        "評価できない（examples/chat/README.md「正直に書くべき限界」参照）。",
    );
  }
}

async function runChat(): Promise<void> {
  const handle = await createExampleRuntime(requireDatabaseUrl());
  printProviderMode(handle.mode);
  try {
    const ctx = { tenantId: `example-chat-${Date.now()}` };
    const conversation = buildConversation(DEFAULT_CHAT_FILLER_PAIRS);

    console.log("\n=== 会話（全ターン） ===");
    for (const turn of conversation.turns) {
      console.log(`${turn.role}: ${turn.text}`);
    }
    console.log(`user(質問): ${conversation.query}`);

    console.log("\n=== 経路A（naive）: 会話ログを全部プロンプトへ積む ===");
    console.log(naivePrompt(conversation));
    const naive = measureNaive(conversation, heuristicTokenCounter);
    console.log(
      `naive usage: chars=${naive.chars} estimatedTokens=${naive.estimatedTokens} (counter=${naive.counter})`,
    );

    console.log("\n=== 経路B（mnemo）: observe() → tick() ===");
    await ingestConversation(handle.runtime, ctx, conversation);
    console.log(
      `${conversation.userUtterances.length} 件の user 発話を observe() し、tick() で embed を処理した。`,
    );

    console.log("\n=== recall()（budget 無し） ===");
    const withoutBudget = await queryRecall(handle.runtime, ctx, conversation);
    console.log(formatRecall(withoutBudget, "budget 無し"));
    console.log("呼び出し側がプロンプトへ積む文字列（recall() の返り値だけから組み立てる例）:");
    console.log(buildMnemoPrompt(withoutBudget));

    console.log(`\n=== budget を渡すと実際に切り詰められる（maxMemoryChars=${TINY_BUDGET_CHARS}） ===`);
    const withBudget = await queryRecall(handle.runtime, ctx, conversation, {
      budget: { maxMemoryChars: TINY_BUDGET_CHARS },
    });
    console.log(formatRecall(withBudget, `budget maxMemoryChars=${TINY_BUDGET_CHARS}`));

    console.log("\n=== まとめ ===");
    console.log(`naive chars                  : ${naive.chars}`);
    console.log(`mnemo chars (budget 無し)      : ${withoutBudget.usage.chars}`);
    console.log(`mnemo chars (budget あり)      : ${withBudget.usage.chars}`);
    console.log(
      "budget_dropped omission (budget あり):",
      withBudget.omitted.find((o) => o.kind === "budget_dropped") ?? "(発生しなかった)",
    );
  } finally {
    await handle.close();
  }
}

async function runCompare(): Promise<void> {
  const handle = await createExampleRuntime(requireDatabaseUrl());
  printProviderMode(handle.mode);
  try {
    console.log(
      "\n会話の長さを変えて、経路A（naive）と経路B（mnemo, budget 無し）の焼かれる量を測る。\n",
    );
    const rows = await runComparison(handle.runtime, {
      fillerPairsSequence: DEFAULT_COMPARE_SEQUENCE,
    });
    console.log(formatComparisonTable(rows));
    console.log(
      "\n(注) mnemo chars は recall() の budget 無し usage.chars。切り詰めていない、そのままの量。",
    );
  } finally {
    await handle.close();
  }
}

function printHelp(): void {
  console.log(
    [
      "使い方:",
      "  DATABASE_URL=... pnpm --filter @mnemo/example-chat run chat     # observe/recall の往復・omitted/usage/budget を実演",
      "  DATABASE_URL=... pnpm --filter @mnemo/example-chat run compare  # 会話の長さを変えて経路A/経路Bの量を実測",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "chat") {
    await runChat();
  } else if (command === "compare") {
    await runCompare();
  } else {
    printHelp();
    if (command !== undefined) {
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
