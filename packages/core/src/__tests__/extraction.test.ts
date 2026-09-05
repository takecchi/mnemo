import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx.js";
import {
  buildNewMemoryFromCandidate,
  extractCandidates,
  resolveDigest,
  truncateForFallbackDigest,
  type ExtractedMemoryCandidate,
} from "../extraction.js";
import type { LLMProvider, StructuredRequest } from "../interfaces/llm-provider.js";
import type { Observation } from "../observation.js";

const ctx: Ctx = { tenantId: "tenant-1" };

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    tenantId: "tenant-1",
    subjectId: "user-1",
    externalId: null,
    kind: "utterance",
    payload: { text: "明日は東京に出張する予定です", speaker: "田中" },
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    recordedAt: new Date("2026-01-01T00:00:01.000Z"),
    ...overrides,
  };
}

/** テストごとに固定の候補集合を返すだけの LLMProvider フェイク。 */
function llmProviderReturning(memories: ExtractedMemoryCandidate[]): LLMProvider {
  return {
    complete: async () => {
      throw new Error("not used in this test");
    },
    completeStructured: async <T>(_ctx: Ctx, req: StructuredRequest<T>): Promise<T> => {
      return req.schema.parse({ memories }) as T;
    },
  };
}

function throwingLlmProvider(): LLMProvider {
  return {
    complete: async () => {
      throw new Error("not used in this test");
    },
    completeStructured: async () => {
      throw new Error("simulated LLM failure (timeout/network)");
    },
  };
}

describe("extractCandidates（roadmap.md 段階3の基本抽出）", () => {
  it("LLM が候補を返せば、そのまま candidates として返す（フォールバックしない）", async () => {
    const provider = llmProviderReturning([
      { content: "東京出張の予定がある", digest: "東京出張予定", provenanceKind: "stated" },
    ]);
    const result = await extractCandidates(provider, ctx, makeObservation());
    expect(result.usedWholeObservationFallback).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.content).toBe("東京出張の予定がある");
  });

  it("LLM が0件を返した場合はフォールバックしない（『何も無い』は正常系）", async () => {
    const provider = llmProviderReturning([]);
    const result = await extractCandidates(provider, ctx, makeObservation());
    expect(result.usedWholeObservationFallback).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("LLM 呼び出し自体が失敗したら、全文をそのまま1件の stated Memory 候補として残す（安全弁）", async () => {
    const provider = throwingLlmProvider();
    const observation = makeObservation();
    const result = await extractCandidates(provider, ctx, observation);
    expect(result.usedWholeObservationFallback).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.content).toBe("明日は東京に出張する予定です");
    expect(result.candidates[0]?.provenanceKind).toBe("stated");
  });

  it("フォールバック候補は payload.text が無い document/event でも空文字にならない", async () => {
    const provider = throwingLlmProvider();
    const observation = makeObservation({
      kind: "event",
      payload: { name: "login", data: { ip: "127.0.0.1" } },
    });
    const result = await extractCandidates(provider, ctx, observation);
    expect(result.candidates[0]?.content).toBe("login");
  });
});

describe("resolveDigest（docs/memory-model.md §4 の安全弁）", () => {
  it("LLM の digest が非空なら、それをそのまま使い digestSource は 'llm'", () => {
    const resolved = resolveDigest({ content: "本文", digest: "要旨" }, 200);
    expect(resolved).toEqual({ digest: "要旨", digestSource: "llm" });
  });

  it("digest が undefined ならフォールバックし digestSource は 'fallback'", () => {
    const resolved = resolveDigest({ content: "本文がここに入る", digest: undefined }, 200);
    expect(resolved.digestSource).toBe("fallback");
    expect(resolved.digest).toBe("本文がここに入る");
  });

  it("digest が空白のみならフォールバックする（LLM が空文字を返した場合と同じ扱い）", () => {
    const resolved = resolveDigest({ content: "本文", digest: "   " }, 200);
    expect(resolved.digestSource).toBe("fallback");
  });
});

describe("truncateForFallbackDigest", () => {
  it("maxLength 以下ならそのまま（末尾の … を付けない）", () => {
    expect(truncateForFallbackDigest("短い本文", 200)).toBe("短い本文");
  });

  it("maxLength を超えたら切り詰めて … を付ける", () => {
    const long = "あ".repeat(10);
    const result = truncateForFallbackDigest(long, 5);
    expect(result).toBe(`${"あ".repeat(5)}…`);
  });

  it("空文字（trim後）には固定のプレースホルダを返す（NOT NULL 制約を満たすため）", () => {
    expect(truncateForFallbackDigest("   ", 200)).toBe("（内容なし）");
  });
});

describe("buildNewMemoryFromCandidate", () => {
  const baseParams = {
    ctx,
    hashContent: (content: string) => `hash(${content})`,
    extractorVersion: "v1",
    llmModelId: "test-model",
    promptVersion: "prompt-v1",
    halfLifeHours: 720,
    now: new Date("2026-02-01T00:00:00.000Z"),
    digestFallbackLength: 200,
  };

  it("provenanceKind: 'stated' は sourceObservationId・at・speaker を持つ", () => {
    const observation = makeObservation();
    const memory = buildNewMemoryFromCandidate({
      ...baseParams,
      observation,
      candidate: { content: "本文", digest: "要旨", provenanceKind: "stated" },
    });
    expect(memory.provenance).toEqual({
      kind: "stated",
      sourceObservationId: "obs-1",
      at: observation.occurredAt!.toISOString(),
      speaker: "田中",
    });
    expect(memory.sourceObservationId).toBe("obs-1");
    expect(memory.extractorVersion).toBe("v1");
    expect(memory.contentHash).toBe("hash(本文)");
    expect(memory.digestSource).toBe("llm");
    expect(memory.embeddingStatus).toBe("pending");
  });

  it("speaker が payload に無い場合、stated provenance に speaker フィールドを含めない", () => {
    const observation = makeObservation({ payload: { text: "本文のみ" } });
    const memory = buildNewMemoryFromCandidate({
      ...baseParams,
      observation,
      candidate: { content: "本文", provenanceKind: "stated" },
    });
    expect(memory.provenance.kind).toBe("stated");
    expect("speaker" in memory.provenance).toBe(false);
  });

  it("provenanceKind: 'inferred' は model/promptVersion/basis/confidence を持つ", () => {
    const observation = makeObservation();
    const memory = buildNewMemoryFromCandidate({
      ...baseParams,
      observation,
      candidate: { content: "推論した内容", provenanceKind: "inferred", confidence: 0.8 },
    });
    expect(memory.provenance).toEqual({
      kind: "inferred",
      model: "test-model",
      promptVersion: "prompt-v1",
      basis: { memoryIds: [], observationIds: ["obs-1"] },
      confidence: 0.8,
    });
  });

  it("provenanceKind: 'inferred' で confidence が省略されたら既定値 0.5 を使う", () => {
    const memory = buildNewMemoryFromCandidate({
      ...baseParams,
      observation: makeObservation(),
      candidate: { content: "推論した内容", provenanceKind: "inferred" },
    });
    expect(memory.provenance.kind === "inferred" && memory.provenance.confidence).toBe(0.5);
  });

  it("occurredAt が無い Observation では recordedAt を freshness の起点として使う（stated.at）", () => {
    const observation = makeObservation({ occurredAt: null });
    const memory = buildNewMemoryFromCandidate({
      ...baseParams,
      observation,
      candidate: { content: "本文", provenanceKind: "stated" },
    });
    expect(memory.occurredAt).toBeNull();
    expect(memory.provenance.kind === "stated" && memory.provenance.at).toBe(
      observation.recordedAt.toISOString(),
    );
  });
});
