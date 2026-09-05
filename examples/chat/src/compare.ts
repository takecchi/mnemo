import { heuristicTokenCounter } from "@mnemo/core";
import type { Ctx, Runtime } from "@mnemo/core";
import { buildConversation } from "./scenario.js";
import { measureNaive } from "./naive-path.js";
import { runMnemoPath } from "./mnemo-path.js";

export interface ComparisonRow {
  fillerPairs: number;
  turnCount: number;
  naiveChars: number;
  naiveTokens: number;
  mnemoChars: number;
  mnemoTokens: number;
  mnemoShareOfNaiveChars: number;
  omittedKinds: string[];
  /** そのテナントのスコープ内総数（`recall().index.totalInScope`）。テナント分離の検査に使う。 */
  totalInScope: number;
}

export interface CompareOptions {
  /** 会話の長さ（filler 往復数）を変えた数点。北極星の物差しに答えるための核心。 */
  fillerPairsSequence: number[];
  /** テナントIDの接頭辞。テスト側から重複を避けるために差し替えられるようにしてある。 */
  tenantPrefix?: string;
}

/**
 * 会話の長さを変えて、経路A（naive）・経路B（mnemo）が実際に焼く量を測る
 * （PR 本文「量の比較」。docs/roadmap.md §4「計測と抑止を混同しない」を踏まえ、
 * ここでは budget を渡さない——「切り詰めずに、そのままだと何文字になるか」を見る）。
 *
 * `fillerPairsSequence` の要素ごとに新しい tenantId を使う。recall() のスコープは
 * テナント単位（docs/recall.md 段0）であり、同じテナントに会話を積み増していくと、
 * 後の計測が前の会話の記憶を引きずってしまい「その長さの会話単体で何文字になるか」
 * を独立に測れなくなる。
 */
export async function runComparison(
  runtime: Runtime,
  options: CompareOptions,
): Promise<ComparisonRow[]> {
  const tenantPrefix = options.tenantPrefix ?? "example-compare";
  const rows: ComparisonRow[] = [];
  for (const fillerPairs of options.fillerPairsSequence) {
    const ctx: Ctx = { tenantId: `${tenantPrefix}-${fillerPairs}` };
    const conversation = buildConversation(fillerPairs);
    const naive = measureNaive(conversation, heuristicTokenCounter);
    const { recall } = await runMnemoPath(runtime, ctx, conversation);
    rows.push({
      fillerPairs,
      turnCount: conversation.turns.length,
      naiveChars: naive.chars,
      naiveTokens: naive.estimatedTokens,
      mnemoChars: recall.usage.chars,
      mnemoTokens: recall.usage.estimatedTokens,
      mnemoShareOfNaiveChars: recall.usage.chars / naive.chars,
      omittedKinds: recall.omitted.map((o) => o.kind),
      totalInScope: recall.index.totalInScope,
    });
  }
  return rows;
}

export function formatComparisonTable(rows: ComparisonRow[]): string {
  const header =
    "| 会話ターン数 | naive chars | naive tokens(概算) | mnemo chars | mnemo tokens(概算) | mnemo/naive (chars) |";
  const sep = "|---|---|---|---|---|---|";
  const body = rows.map((r) => {
    const ratio = `${(r.mnemoShareOfNaiveChars * 100).toFixed(1)}%`;
    return `| ${r.turnCount} | ${r.naiveChars} | ${r.naiveTokens} | ${r.mnemoChars} | ${r.mnemoTokens} | ${ratio} |`;
  });
  return [header, sep, ...body].join("\n");
}
