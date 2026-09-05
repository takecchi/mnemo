import type { Ctx, RecallBudget, RecallResult, Runtime } from "@mnemora/core";
import type { Conversation } from "./scenario.js";

export interface MnemoraPathOptions {
  budget?: RecallBudget;
}

export interface MnemoraPathResult {
  recall: RecallResult;
}

/**
 * 会話全体を observe() し、tick() で embed を処理する（経路Bの取り込み段）。
 *
 * `externalId` に turn の連番を使う——同じ `conversation` に対してこの関数を
 * 2度呼んでも（例: recall() を budget 有り/無しで2通り試したい呼び出し側が、
 * 誤ってもう一度 ingest してしまっても）Observation が重複して作られない
 * （roadmap.md 段階3の冪等性がそのまま効く）。**呼び出し側は ingest と query を
 * 混ぜて何度も呼ばない**のが前提だが、それでも壊れないようにしてある。
 */
export async function ingestConversation(
  runtime: Runtime,
  ctx: Ctx,
  conversation: Conversation,
): Promise<void> {
  for (const turn of conversation.userUtterances) {
    await runtime.observe(ctx, {
      kind: "utterance",
      text: turn.text,
      speaker: turn.role,
      externalId: `turn-${turn.index}`,
    });
  }
  await runtime.tick(ctx, { kinds: ["embed"] });
}

/**
 * 経路B（mnemora）の想起段。ingest 済みの `ctx` に対して、終盤の質問を recall() する。
 *
 * **呼び出し側が実際にプロンプトへ積むのは `recall().memories`（の digest）と
 * `index` だけであり、`usage` はその量をそのまま計測している**（docs/recall.md §6）。
 * mnemora 自身はプロンプトを組み立てない（同§6「正直に書くべき限界」）——ここでは
 * その組み立てをサンプルアプリ側（呼び出し側の役）が代行して見せている。
 *
 * `opts.budget` を渡すと、段4（予算による切り詰め）が実際に候補を落とす
 * （docs/recall.md §2 段4）。渡さなければ切り詰めは起こらない。
 */
export async function queryRecall(
  runtime: Runtime,
  ctx: Ctx,
  conversation: Conversation,
  opts: MnemoraPathOptions = {},
): Promise<RecallResult> {
  return runtime.recall(ctx, {
    text: conversation.query,
    ...(opts.budget !== undefined ? { budget: opts.budget } : {}),
  });
}

/** `ingestConversation` + `queryRecall` を1回で行う便宜関数（`compare.ts` が使う）。 */
export async function runMnemoraPath(
  runtime: Runtime,
  ctx: Ctx,
  conversation: Conversation,
  opts: MnemoraPathOptions = {},
): Promise<MnemoraPathResult> {
  await ingestConversation(runtime, ctx, conversation);
  const recall = await queryRecall(runtime, ctx, conversation, opts);
  return { recall };
}

/**
 * mnemora path が実際にプロンプトへ積む文字列を、`recall()` の返り値だけから組み立てる。
 * `usage.chars` が数えているのと同じ材料（各 memory の digest + index band の JSON）を
 * 呼び出し側の視点で再現する——「mnemora はプロンプトを組み立てない」ことを実演する関数。
 */
export function buildMnemoraPrompt(recall: RecallResult): string {
  const digestLines = recall.memories.map((m) => `- ${m.digest}`).join("\n");
  const indexLine = `(索引: スコープ内 ${recall.index.totalInScope} 件のうち ${recall.memories.length} 件を提示)`;
  return [digestLines, indexLine].filter((s) => s.length > 0).join("\n");
}
