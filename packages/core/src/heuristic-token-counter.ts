import type { TokenCounter } from "./interfaces/token-counter.js";

/**
 * 既定の `TokenCounter` 実装（docs/architecture.md §5.9）。
 *
 * モデル固有のトークナイザに依存しない文字数ベースの推定。英語圏で経験的に使われる
 * 「4文字 ≈ 1トークン」という粗い目安を採用する。**常に `counter: 'heuristic'` を返す**
 * ——推定値を実測値の顔で返さない、という契約そのもの。
 */
export const heuristicTokenCounter: TokenCounter = {
  count(text: string): { tokens: number; counter: "heuristic" } {
    const tokens = Math.ceil(text.length / 4);
    return { tokens, counter: "heuristic" };
  },
};
