import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx.js";
import type { LLMProvider, StructuredRequest } from "../interfaces/llm-provider.js";
import { createRuntime } from "../runtime.js";
import { createFakeRuntimeStores } from "./runtime-fakes.js";

const ctx: Ctx = { tenantId: "tenant-1" };

function llmReturning(
  memories: {
    content: string;
    digest?: string;
    provenanceKind: "stated" | "inferred";
    confidence?: number;
  }[],
): LLMProvider {
  return {
    complete: async () => {
      throw new Error("not used");
    },
    completeStructured: async <T>(_ctx: Ctx, req: StructuredRequest<T>): Promise<T> =>
      req.schema.parse({ memories }) as T,
  };
}

function throwingLlm(): LLMProvider {
  return {
    complete: async () => {
      throw new Error("not used");
    },
    completeStructured: async () => {
      throw new Error("simulated LLM outage");
    },
  };
}

function buildRuntime(
  llmProvider: LLMProvider,
  overrides: Partial<Parameters<typeof createRuntime>[0]> = {},
) {
  const stores = createFakeRuntimeStores();
  const runtime = createRuntime({
    memoryStore: stores.memoryStore,
    outboxStore: stores.outboxStore,
    vectorStore: stores.vectorStore,
    eventStore: stores.eventStore,
    tenantSettingsStore: stores.tenantSettingsStore,
    llmProvider,
    embeddingProvider: stores.embeddingProvider,
    hashContent: (content: string) => `sha256(${content})`,
    ...overrides,
  });
  return { runtime, stores };
}

describe("runtime.observe — extract: 'sync'（既定, D2）", () => {
  it("utterance を観測すると、その場で抽出されて Memory が作られる", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "東京出張がある", digest: "東京出張", provenanceKind: "stated" }]),
    );
    const result = await runtime.observe(ctx, { kind: "utterance", text: "明日東京に出張します" });

    expect(result.extracted).toBe(true);
    expect(result.memoryIds).toHaveLength(1);
    const memory = await stores.memoryStore.get(ctx, result.memoryIds[0]!);
    expect(memory?.digest).toBe("東京出張");
    expect(memory?.digestSource).toBe("llm");
    expect(memory?.sourceObservationId).toBe(result.observationId);
  });

  it("digest 生成に失敗した候補は digestSource: 'fallback' で content は必ず保持される", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "長い本文がここに入ります", provenanceKind: "stated" }]),
    );
    const result = await runtime.observe(ctx, { kind: "utterance", text: "テスト発話" });
    const memory = await stores.memoryStore.get(ctx, result.memoryIds[0]!);
    expect(memory?.digestSource).toBe("fallback");
    expect(memory?.content).toBe("長い本文がここに入ります");
  });

  it("LLM 呼び出し自体が失敗しても observe() 全体は失敗せず、全文を保持した Memory が1件残る", async () => {
    const { runtime, stores } = buildRuntime(throwingLlm());
    const result = await runtime.observe(ctx, {
      kind: "utterance",
      text: "障害時でも残したい発話",
    });
    expect(result.extracted).toBe(true);
    expect(result.memoryIds).toHaveLength(1);
    const memory = await stores.memoryStore.get(ctx, result.memoryIds[0]!);
    expect(memory?.content).toBe("障害時でも残したい発話");
    expect(memory?.provenance.kind).toBe("stated");
  });

  it("createMemory の contentHash は注入された hashContent で計算される（core は計算しない, D16）", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文X", digest: "要旨X", provenanceKind: "stated" }]),
    );
    const result = await runtime.observe(ctx, { kind: "utterance", text: "本文X" });
    const memory = await stores.memoryStore.get(ctx, result.memoryIds[0]!);
    expect(memory?.contentHash).toBe("sha256(本文X)");
  });

  it("Memory 作成時に 'created' イベントが監査ログへ記録される", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    const result = await runtime.observe(ctx, { kind: "utterance", text: "本文" });
    const events = await stores.eventStore.list(ctx, { memoryId: result.memoryIds[0]! });
    expect(events.some((e) => e.kind === "created")).toBe(true);
  });

  it("LLM が0件の候補を返したら Memory は作られない（ゴミ記憶を増やさない）", async () => {
    const { runtime } = buildRuntime(llmReturning([]));
    const result = await runtime.observe(ctx, {
      kind: "utterance",
      text: "特に記憶するまでもない雑談",
    });
    expect(result.extracted).toBe(true);
    expect(result.memoryIds).toEqual([]);
  });

  it("extract 済みの extract ジョブは outbox 上で completed になる（黙って溜め込まない）", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    await runtime.observe(ctx, { kind: "utterance", text: "本文" });
    const pending = await stores.outboxStore.claimBatch(ctx, {
      kinds: ["extract"],
      limit: 10,
      now: new Date(),
      claimedBy: "test",
    });
    expect(pending).toEqual([]);
  });

  it("embed ジョブは sync 抽出でも常に outbox 経由（未処理のまま残る）", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    await runtime.observe(ctx, { kind: "utterance", text: "本文" });
    const pending = await stores.outboxStore.claimBatch(ctx, {
      kinds: ["embed"],
      limit: 10,
      now: new Date(),
      claimedBy: "test",
    });
    expect(pending).toHaveLength(1);
  });
});

describe("runtime.observe — extract: 'deferred'", () => {
  it("deferred では抽出されず、extract ジョブが outbox に残る", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    const result = await runtime.observe(ctx, {
      kind: "utterance",
      text: "本文",
      extract: "deferred",
    });
    expect(result.extracted).toBe(false);
    expect(result.memoryIds).toEqual([]);

    const pending = await stores.outboxStore.claimBatch(ctx, {
      kinds: ["extract"],
      limit: 10,
      now: new Date(),
      claimedBy: "test",
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload.observationId).toBe(result.observationId);
  });

  it("runtime.tick で deferred の extract ジョブを消化すると Memory が作られる", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    const result = await runtime.observe(ctx, {
      kind: "utterance",
      text: "本文",
      extract: "deferred",
    });
    expect(result.memoryIds).toEqual([]);

    const tickResult = await runtime.tick(ctx, { kinds: ["extract"] });
    expect(tickResult).toEqual({ processed: 1, failed: 0 });

    const memories = [...(await stores.memoryStore.countByGroup(ctx, {}))];
    const total = memories.reduce((sum, g) => sum + g.count, 0);
    expect(total).toBe(1);
  });
});

describe("runtime.observe — 冪等性（roadmap.md 段階3の完了条件）", () => {
  it("同じ externalId の Observation を二重に送っても Memory が重複して作られない", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    const first = await runtime.observe(ctx, {
      kind: "utterance",
      text: "本文",
      externalId: "ext-1",
    });
    const second = await runtime.observe(ctx, {
      kind: "utterance",
      text: "本文（無視されるべき別内容）",
      externalId: "ext-1",
    });

    expect(second.observationId).toBe(first.observationId);
    expect(second.extracted).toBe(false);
    expect(second.memoryIds).toEqual([]);

    const groups = await stores.memoryStore.countByGroup(ctx, {});
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    expect(total).toBe(1);
  });

  it("冪等な再送では新しい outbox ジョブを積まない", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    await runtime.observe(ctx, { kind: "utterance", text: "本文", externalId: "ext-2" });
    await runtime.observe(ctx, { kind: "utterance", text: "本文", externalId: "ext-2" });

    // 最初の1回の抽出で作られた embed ジョブ(1件)だけが残っているはず。
    const pending = await stores.outboxStore.claimBatch(ctx, {
      kinds: ["embed"],
      limit: 10,
      now: new Date(),
      claimedBy: "test",
    });
    expect(pending).toHaveLength(1);
  });
});

describe("runtime.observe — memory_usage（ADR 0009）", () => {
  it("使用報告は抽出器を通らず、recall_usages への挿入と reinforce だけを行う", async () => {
    const { runtime, stores } = buildRuntime(llmReturning([]));
    const memory = await stores.memoryStore.createMemory(ctx, {
      tenantId: "tenant-1",
      subjectId: null,
      sourceObservationId: null,
      extractorVersion: null,
      content: "本文",
      contentHash: "hash",
      digest: "要旨",
      digestSource: "llm",
      provenance: { kind: "imported", batchId: "batch-1" },
      tags: [],
      occurredAt: null,
      recordedAt: new Date("2026-01-01T00:00:00.000Z"),
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 720,
      decayFloorAt: new Date("2026-06-01T00:00:00.000Z"),
      embeddingStatus: "pending",
    });

    const result = await runtime.observe(ctx, {
      kind: "memory_usage",
      recallId: "recall-1",
      usedMemoryIds: [memory.id],
    });

    expect(result.extracted).toBe(false);
    expect(result.memoryIds).toEqual([memory.id]);
    const reinforced = await stores.memoryStore.get(ctx, memory.id);
    expect(reinforced?.lastReinforcedAt).not.toBeNull();
  });

  it("同じ (recallId, memoryId) の再送では reinforce が二重に走らない（insertedMemoryIds が空）", async () => {
    const { runtime, stores } = buildRuntime(llmReturning([]));
    const memory = await stores.memoryStore.createMemory(ctx, {
      tenantId: "tenant-1",
      subjectId: null,
      sourceObservationId: null,
      extractorVersion: null,
      content: "本文",
      contentHash: "hash",
      digest: "要旨",
      digestSource: "llm",
      provenance: { kind: "imported", batchId: "batch-1" },
      tags: [],
      occurredAt: null,
      recordedAt: new Date("2026-01-01T00:00:00.000Z"),
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 720,
      decayFloorAt: new Date("2026-06-01T00:00:00.000Z"),
      embeddingStatus: "pending",
    });

    await runtime.observe(ctx, {
      kind: "memory_usage",
      recallId: "recall-1",
      usedMemoryIds: [memory.id],
    });
    const second = await runtime.observe(ctx, {
      kind: "memory_usage",
      recallId: "recall-1",
      usedMemoryIds: [memory.id],
    });
    expect(second.memoryIds).toEqual([]);
  });
});

describe("runtime.tick — embed ジョブ（embeddingStatus の遷移）", () => {
  it("embed ジョブを処理すると embeddingStatus が 'ready' になり、vector が upsert される", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    const observeResult = await runtime.observe(ctx, { kind: "utterance", text: "本文" });
    const memoryId = observeResult.memoryIds[0]!;

    const tickResult = await runtime.tick(ctx, { kinds: ["embed"] });
    expect(tickResult).toEqual({ processed: 1, failed: 0 });

    const memory = await stores.memoryStore.get(ctx, memoryId);
    expect(memory?.embeddingStatus).toBe("ready");
    expect(stores.vectorStore.entries.size).toBe(1);
  });

  it("embedding provider が失敗すると embeddingStatus が 'failed' になり、tick は failed をカウントする", async () => {
    const { runtime, stores } = buildRuntime(
      llmReturning([{ content: "本文", digest: "要旨", provenanceKind: "stated" }]),
    );
    const observeResult = await runtime.observe(ctx, { kind: "utterance", text: "本文" });
    const memoryId = observeResult.memoryIds[0]!;

    stores.embeddingProvider.shouldFail = true;
    const tickResult = await runtime.tick(ctx, { kinds: ["embed"] });
    expect(tickResult).toEqual({ processed: 0, failed: 1 });

    const memory = await stores.memoryStore.get(ctx, memoryId);
    expect(memory?.embeddingStatus).toBe("failed");
  });
});

describe("runtime.tick — 未知の outbox job kind", () => {
  it("未知の kind は無視して溜め込まず、失敗として扱う", async () => {
    const { runtime, stores } = buildRuntime(llmReturning([]));
    // observe を経由せず、直接 outbox に不正な kind のジョブを積む状況を再現する。
    const { jobs } = await stores.memoryStore.createObservationWithOutbox(
      ctx,
      { tenantId: "tenant-1", subjectId: null, externalId: null, kind: "utterance", payload: {} },
      ["mystery-kind"],
    );
    expect(jobs).toHaveLength(1);

    const tickResult = await runtime.tick(ctx, { kinds: ["mystery-kind"] });
    expect(tickResult).toEqual({ processed: 0, failed: 1 });
  });
});
