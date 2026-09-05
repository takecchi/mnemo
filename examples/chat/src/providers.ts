import type { EmbeddingProvider, LLMProvider } from "@mnemora/core";
import { OpenAIEmbeddingProvider, OpenAILLMProvider } from "@mnemora/openai";
import { DeterministicEmbeddingProvider, DeterministicLLMProvider } from "@mnemora/testkit";
import type { UsageMeter } from "./usage-meter.js";
import { createUsageMeter } from "./usage-meter.js";

/**
 * サンプルアプリが実際に使う provider の切り替え（PR 本文「LLM/Embedding は実 API キーが
 * 無くても動く」）。
 *
 * **黙って擬似物へフォールバックしない**——`mode` を呼び出し側（cli.ts）に返し、
 * 画面に必ず表示させる。どちらで動いているかを隠さない、という原則の姿3の適用。
 *
 * **LLM と Embedding を別々に選べる（本 PR の拡張）。** 理由: retrieval-quality の
 * ベンチで「順位が変わったのは埋め込みのせいか抽出のせいか」を切り分けたい場合、
 * 一方だけを本物に入れ替えられる必要がある。`MNEMORA_LLM` / `MNEMORA_EMBEDDING`
 * （`"openai" | "deterministic"`）で個別に上書きできる——**未指定なら、いままで通り
 * `OPENAI_API_KEY` の有無だけで両方が決まる**（`selectProviderMode` の契約は変えない。
 * 既存テストはこの2つの環境変数を設定しないため、そのまま通る）。
 */
export type ProviderMode = "openai" | "deterministic";

export interface Providers {
  /**
   * 後方互換のために残す単一ラベル。`MNEMORA_LLM`/`MNEMORA_EMBEDDING` を使わない
   * 呼び出し（既存の `chat`/`compare`）では `llmMode`/`embeddingMode` と必ず一致する。
   * 個別に上書きした場合にどちらの実体を指すかは曖昧になるため、**新しいコードは
   * `llmMode`/`embeddingMode` を見ること**。
   */
  mode: ProviderMode;
  llmMode: ProviderMode;
  embeddingMode: ProviderMode;
  llmProvider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  /** `llmMode`/`embeddingMode` のどちらかが `"openai"` のときだけ存在する。 */
  usageMeter?: UsageMeter;
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
 *
 * **この関数のシグネチャ・振る舞いは変えていない**（既存テスト `providers.test.ts` が
 * 直接呼んでいるため）。`MNEMORA_LLM`/`MNEMORA_EMBEDDING` による個別上書きは
 * `selectLLMMode`/`selectEmbeddingMode` という別関数に足す。
 */
export function selectProviderMode(env: EnvLike): ProviderMode {
  return env.OPENAI_API_KEY ? "openai" : "deterministic";
}

/** `MNEMORA_LLM`/`MNEMORA_EMBEDDING` の値を検証する。空文字は「未指定」として扱う。 */
function parseModeOverride(varName: "MNEMORA_LLM" | "MNEMORA_EMBEDDING", value: string | undefined): ProviderMode | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "openai" || value === "deterministic") {
    return value;
  }
  throw new Error(
    `${varName} には "openai" か "deterministic" のいずれかを指定すること（実際: "${value}"）。`,
  );
}

/** `MNEMORA_LLM` が指定されていればそれを、無ければ `selectProviderMode` の結果を使う。 */
export function selectLLMMode(env: EnvLike): ProviderMode {
  return parseModeOverride("MNEMORA_LLM", env.MNEMORA_LLM) ?? selectProviderMode(env);
}

/** `MNEMORA_EMBEDDING` が指定されていればそれを、無ければ `selectProviderMode` の結果を使う。 */
export function selectEmbeddingMode(env: EnvLike): ProviderMode {
  return parseModeOverride("MNEMORA_EMBEDDING", env.MNEMORA_EMBEDDING) ?? selectProviderMode(env);
}

export function createProviders(env: EnvLike = process.env): Providers {
  const mode = selectProviderMode(env);
  const llmMode = selectLLMMode(env);
  const embeddingMode = selectEmbeddingMode(env);

  // LLM・Embedding のどちらか一方でも本物を使うなら、1つの usage-meter（1つの実
  // OpenAI クライアント）を両方で共有する——呼び出し回数・トークン・費用をこのプロセスの
  // 実行全体で一箇所に集計するため（PR 本文 (A)）。
  const usageMeter =
    llmMode === "openai" || embeddingMode === "openai"
      ? createUsageMeter({
          apiKey: env.OPENAI_API_KEY,
          llmModel: OPENAI_LLM_MODEL,
          embeddingModel: OPENAI_EMBEDDING_MODEL,
        })
      : undefined;

  const llmProvider: LLMProvider =
    llmMode === "openai"
      ? new OpenAILLMProvider({
          apiKey: env.OPENAI_API_KEY,
          model: OPENAI_LLM_MODEL,
          client: usageMeter?.client,
        })
      : new DeterministicLLMProvider();

  const embeddingProvider: EmbeddingProvider =
    embeddingMode === "openai"
      ? new OpenAIEmbeddingProvider({
          apiKey: env.OPENAI_API_KEY,
          model: OPENAI_EMBEDDING_MODEL,
          dimensions: OPENAI_EMBEDDING_DIMENSIONS,
          client: usageMeter?.client,
        })
      : new DeterministicEmbeddingProvider(DETERMINISTIC_EMBEDDING_SPACE);

  return {
    mode,
    llmMode,
    embeddingMode,
    llmProvider,
    embeddingProvider,
    ...(usageMeter !== undefined ? { usageMeter } : {}),
  };
}
