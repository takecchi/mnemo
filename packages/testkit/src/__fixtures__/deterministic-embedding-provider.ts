import type { Ctx, EmbeddingProvider, EmbeddingSpaceId } from "@mnemora/core";

/**
 * `EmbeddingProvider` の決定的な擬似実装（roadmap.md 段階3・PR 本文「擬似物の扱い」）。
 *
 * 本物の埋め込みモデルを模してはいない。文字コードから機械的にベクトルを作るだけであり、
 * 意味的な類似度は一切表現しない。**同じテキストには常に同じベクトルを返す**ことだけを
 * 保証する（decay/recall のテストではなく、observe → embed → embeddingStatus 遷移の
 * 配線を検査するために十分な性質）。
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly space: EmbeddingSpaceId;

  constructor(
    space: EmbeddingSpaceId = { provider: "testkit", model: "deterministic", dimensions: 8 },
  ) {
    this.space = space;
  }

  async embed(_ctx: Ctx, texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    const vector = new Array<number>(this.space.dimensions).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      const bucket = i % this.space.dimensions;
      vector[bucket] = (vector[bucket] ?? 0) + text.charCodeAt(i);
    }
    // 桁を丸めて安定した比較をしやすくする（浮動小数の誤差を避ける）。
    return vector.map((value) => Math.round((value % 997) * 1000) / 1000);
  }
}
