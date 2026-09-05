import type { TokenCounter } from "@mnemora/core";
import type { Conversation } from "./scenario.js";

export interface PathMeasurement {
  chars: number;
  estimatedTokens: number;
  counter: "heuristic" | "exact";
}

/**
 * 経路A（naive）: 会話ログを全部プロンプトへ積む、mnemora を使わない今の普通のやり方。
 *
 * ここで作るのは「システムプロンプト無しの生の transcript」だけである——mnemora が
 * 何をどれだけ削れているかを見るための最小構成であり、実際のアプリケーションは
 * これにシステムプロンプトやツール定義がさらに乗る分、削減の絶対値はここで測る
 * 数字よりも大きくなりうる（examples/chat/README.md「限界」参照）。
 */
export function naivePrompt(conversation: Conversation): string {
  return conversation.turns.map((t) => `${t.role}: ${t.text}`).join("\n");
}

export function measureNaive(
  conversation: Conversation,
  tokenCounter: TokenCounter,
): PathMeasurement {
  const text = naivePrompt(conversation);
  const counted = tokenCounter.count(text);
  return { chars: text.length, estimatedTokens: counted.tokens, counter: counted.counter };
}
