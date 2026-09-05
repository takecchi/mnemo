import OpenAI from "openai";
import type { Ctx, EmbeddingProvider, EmbeddingSpaceId } from "@mnemora/core";

/**
 * `packages/openai` の `EmbeddingProvider` 実装（docs/architecture.md §5.5）。
 *
 * 契約: 1インスタンス = 1 `EmbeddingSpaceId` に固定する（D8・§5.5）。`model` /
 * `dimensions` はコンストラクタ引数で固定され、実行時に変わらない。
 *
 * `client` を注入できるようにしてある。本番では省略して OpenAI SDK の既定クライアント
 * （`OPENAI_API_KEY` 環境変数を読む）を使うが、テストでは本物の HTTP を叩かない
 * 手書きの偽クライアントを注入する（PR 本文「擬似物の扱い」参照。ここで擬似にしているのは
 * ネットワーク呼び出しの往復だけであり、`EmbeddingSpaceId` の固定・入出力の対応付けは
 * 本物のロジックを検査している）。
 */
export interface OpenAIEmbeddingProviderOptions {
  apiKey?: string;
  model: string;
  dimensions: number;
  client?: Pick<OpenAI, "embeddings">;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly space: EmbeddingSpaceId;
  private readonly client: Pick<OpenAI, "embeddings">;
  private readonly model: string;

  constructor(options: OpenAIEmbeddingProviderOptions) {
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.space = { provider: "openai", model: options.model, dimensions: options.dimensions };
  }

  async embed(_ctx: Ctx, texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.space.dimensions,
    });
    // OpenAI は入力順を保つと文書化しているが、`index` で並べ直して前提を作らない
    // （原則の姿3寄り: 順序の保証を暗黙のものとして信頼しない）。
    return [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
