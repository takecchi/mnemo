import type { EmbeddingProvider, LLMProvider } from "@mnemo/core";
import { OpenAIEmbeddingProvider, OpenAILLMProvider } from "@mnemo/openai";
import { DeterministicEmbeddingProvider, DeterministicLLMProvider } from "@mnemo/testkit";

/**
 * サンプルアプリが実際に使う provider の切り替え（PR 本文「LLM/Embedding は実 API キーが
 * 無くても動く」）。
 *
 * **黙って擬似物へフォールバックしない**——`mode` を呼び出し側（cli.ts）に返し、
 * 画面に必ず表示させる。どちらで動いているかを隠さない、という原則の姿3の適用。
 */
export type ProviderMode = "openai" | "deterministic";

export interface Providers {
  mode: ProviderMode;
  llmProvider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
}

/** 本物の OpenAI を使う場合のモデル選定。サンプルアプリの裁量値であり、強い根拠は無い。 */
export const OPENAI_LLM_MODEL = "gpt-4o-mini";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
/** 次元を絞って埋め込みテーブル・HNSW 索引を軽くする（サンプルアプリの裁量値）。 */
export const OPENAI_EMBEDDING_DIMENSIONS = 256;

/** 擬似 provider が使う埋め込み空間。`DeterministicEmbeddingProvider` の既定と揃える。 */
export const DETERMINISTIC_EMBEDDING_SPACE = {
  provider: "testkit",
  model: "deterministic",
  dimensions: 8,
};

export type EnvLike = Partial<Record<string, string | undefined>>;

/**
 * `OPENAI_API_KEY` が空でない値として存在するかどうかだけを見る、切り替えの単一の分岐点。
 * `createProviders` から切り出してあるのは、副作用（provider の構築）無しに分岐の単体テストを
 * 書けるようにするため。
 */
export function selectProviderMode(env: EnvLike): ProviderMode {
  return env.OPENAI_API_KEY ? "openai" : "deterministic";
}

export function createProviders(env: EnvLike = process.env): Providers {
  const mode = selectProviderMode(env);
  if (mode === "openai") {
    return {
      mode,
      llmProvider: new OpenAILLMProvider({ apiKey: env.OPENAI_API_KEY, model: OPENAI_LLM_MODEL }),
      embeddingProvider: new OpenAIEmbeddingProvider({
        apiKey: env.OPENAI_API_KEY,
        model: OPENAI_EMBEDDING_MODEL,
        dimensions: OPENAI_EMBEDDING_DIMENSIONS,
      }),
    };
  }
  return {
    mode,
    llmProvider: new DeterministicLLMProvider(),
    embeddingProvider: new DeterministicEmbeddingProvider(DETERMINISTIC_EMBEDDING_SPACE),
  };
}
