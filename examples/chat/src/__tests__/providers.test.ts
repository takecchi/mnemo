import { describe, expect, it } from "vitest";
import { OpenAIEmbeddingProvider, OpenAILLMProvider } from "@mnemora/openai";
import { DeterministicEmbeddingProvider, DeterministicLLMProvider } from "@mnemora/testkit";
import { createProviders, selectProviderMode } from "../providers.js";

/**
 * `selectProviderMode`/`createProviders` の唯一の分岐（`OPENAI_API_KEY` の有無）に、
 * 両方向から歯を通す。実際の OpenAI へのネットワーク呼び出しは行わない
 * （provider の構築だけを検査する。`packages/openai/src/__tests__/live.openai.test.ts` と
 * 同じ区別——構築のロジックと、本物の API 呼び出しは別に検査する）。
 */
describe("selectProviderMode", () => {
  it("OPENAI_API_KEY が無い場合は 'deterministic'", () => {
    expect(selectProviderMode({})).toBe("deterministic");
  });

  it("OPENAI_API_KEY が空文字の場合も 'deterministic'（falsy 扱い）", () => {
    expect(selectProviderMode({ OPENAI_API_KEY: "" })).toBe("deterministic");
  });

  it("OPENAI_API_KEY がある場合は 'openai'", () => {
    expect(selectProviderMode({ OPENAI_API_KEY: "sk-fake-for-test" })).toBe("openai");
  });
});

describe("createProviders", () => {
  it("鍵が無ければ deterministic な擬似 provider を返す", () => {
    const providers = createProviders({});
    expect(providers.mode).toBe("deterministic");
    expect(providers.llmProvider).toBeInstanceOf(DeterministicLLMProvider);
    expect(providers.embeddingProvider).toBeInstanceOf(DeterministicEmbeddingProvider);
  });

  it("鍵があれば OpenAI の provider を返す（構築のみ。ネットワーク呼び出しはしない）", () => {
    const providers = createProviders({ OPENAI_API_KEY: "sk-fake-for-test" });
    expect(providers.mode).toBe("openai");
    expect(providers.llmProvider).toBeInstanceOf(OpenAILLMProvider);
    expect(providers.embeddingProvider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });
});
