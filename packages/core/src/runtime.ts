import { systemClock } from "./clock.js";
import type { Clock } from "./interfaces/clock.js";
import type { Ctx } from "./ctx.js";
import { buildNewMemoryFromCandidate, extractCandidates } from "./extraction.js";
import type { ExtractionOutcome } from "./extraction.js";
import type { EmbeddingProvider } from "./interfaces/embedding-provider.js";
import type { EventStore } from "./interfaces/event-store.js";
import type { LLMProvider } from "./interfaces/llm-provider.js";
import type { MemoryStore } from "./interfaces/memory-store.js";
import type { ClaimOutboxJobsOptions, OutboxStore } from "./interfaces/outbox-store.js";
import type { OutboxJobKind } from "./interfaces/scheduler.js";
import type { TenantSettingsStore } from "./interfaces/tenant-settings-store.js";
import type { VectorStore } from "./interfaces/vector-store.js";
import type { MemoryId, ObservationId } from "./ids.js";
import type {
  ObserveDocumentInput,
  ObserveEventInput,
  ObserveInput,
  ObserveUtteranceInput,
  ObserveInputKind,
} from "./observation.js";
import { ObserveInputSchema, observeInputKindToObservationKind } from "./observation.js";
import type { NewObservation, Observation } from "./observation.js";
import type { OutboxJobRecord } from "./outbox.js";

/**
 * `runtime.observe` / `runtime.tick` の実装（roadmap.md 段階3、docs/architecture.md §3.2・§3.3）。
 *
 * **runtime は `packages/core` に置く**（docs/architecture.md §4）。ただし core は zod 以外の
 * 実行時依存を持てない（§3.6）ため、DB・LLM・埋め込み・時刻・ハッシュ計算はすべて
 * `createRuntime(deps)` の呼び出し側が注入する。core 自身はこれらの実体を import しない。
 *
 * D16 の反映: `contentHash`（SHA-256 hex）の実装は core に置かない。`deps.hashContent` として
 * 注入される関数（`node:crypto` を使う実装は adapter 側、例えば `packages/postgres` の
 * `sha256Hex`）に委ねる。runtime はこの関数を「呼ぶ」だけで、計算そのものは行わない。
 */

export interface RuntimeConfig {
  /** 抽出器のバージョン。冪等キー `(observationId, extractorVersion)` の一部になる。 */
  extractorVersion?: string;
  /** `provenance.inferred.model` に書き込むモデル識別子。呼び出し側の LLMProvider の実体に合わせる。 */
  llmModelId?: string;
  /** `provenance.inferred.promptVersion`。抽出プロンプトを変えたら上げる。 */
  promptVersion?: string;
  /** digest フォールバック（機械的な先頭文字列切り出し）の最大文字数。既定 200。 */
  digestFallbackLength?: number;
  /** `tick` の既定 claimedBy 値。複数ワーカーを区別したい場合に指定する。 */
  defaultClaimedBy?: string;
}

const DEFAULT_EXTRACTOR_VERSION = "v1";
const DEFAULT_LLM_MODEL_ID = "unknown";
const DEFAULT_PROMPT_VERSION = "v1";
const DEFAULT_DIGEST_FALLBACK_LENGTH = 200;
const DEFAULT_CLAIMED_BY = "runtime.tick";
const DEFAULT_TICK_LIMIT = 50;

export interface RuntimeDeps {
  memoryStore: MemoryStore;
  outboxStore: OutboxStore;
  vectorStore: VectorStore;
  eventStore: EventStore;
  tenantSettingsStore: TenantSettingsStore;
  llmProvider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  /** 省略時は `systemClock`。 */
  clock?: Clock;
  /** D16: SHA-256 hex 等、content からハッシュを計算する関数（core は計算しない）。 */
  hashContent: (content: string) => string;
  config?: RuntimeConfig;
}

export interface ObserveResult {
  observationId: ObservationId;
  /**
   * sync 抽出で実際に作られた（または既存の冪等な行として返された）Memory の id。
   * `deferred` の場合、または冪等な再送（`created: false`）の場合は空配列——
   * **この場合に「以前作られた Memory の id」を遡って探すことはしない**（本 PR の決定。
   * PR 本文参照）。
   */
  memoryIds: MemoryId[];
  /**
   * この呼び出しの中で抽出がどうなったか。
   *
   * **`boolean` にしない。**「抽出した / していない」の2値に潰すと、
   * **LLM 呼び出しが失敗して全文フォールバックへ倒れた**という第三の状態が
   * 「抽出した」と同じ顔になる。ADR 0008 の判定基準——その区別があると
   * 呼び出し側の次の一手が変わるか——に照らすと、これは潰してはいけない区別である
   * （`llm_failed_whole_observation` なら、provider の復旧後に抽出をやり直す、
   * という一手がある。`ok` にはその一手が無い）。
   */
  extraction: ExtractionOutcome;
}

export interface TickOptions {
  limit?: number;
  kinds?: OutboxJobKind[];
  claimedBy?: string;
}

export interface TickResult {
  processed: number;
  failed: number;
}

export interface Runtime {
  observe(ctx: Ctx, input: ObserveInput): Promise<ObserveResult>;
  /**
   * outbox に溜まったジョブを消化する（docs/architecture.md §3.3）。
   * `extract: 'deferred'` かつ `InlineScheduler`（キュー無し）構成では、これを誰かが
   * 明示的に呼ばない限り抽出・埋め込みは永久に走らない——「キューが無ければ黙って
   * 何も起きない」を作らない、という設計方針をそのまま体現する。
   */
  tick(ctx: Ctx, opts?: TickOptions): Promise<TickResult>;
}

function extractObservationPayload(
  input: ObserveUtteranceInput | ObserveEventInput | ObserveDocumentInput,
): unknown {
  switch (input.kind) {
    case "utterance":
      return { text: input.text, speaker: input.speaker };
    case "event":
      return { name: input.name, data: input.data ?? {} };
    case "document":
      return { title: input.title, content: input.content };
    default: {
      const exhaustive: never = input;
      throw new Error(`unreachable observe input kind: ${String(exhaustive)}`);
    }
  }
}

export function createRuntime(deps: RuntimeDeps): Runtime {
  const clock = deps.clock ?? systemClock;
  const extractorVersion = deps.config?.extractorVersion ?? DEFAULT_EXTRACTOR_VERSION;
  const llmModelId = deps.config?.llmModelId ?? DEFAULT_LLM_MODEL_ID;
  const promptVersion = deps.config?.promptVersion ?? DEFAULT_PROMPT_VERSION;
  const digestFallbackLength = deps.config?.digestFallbackLength ?? DEFAULT_DIGEST_FALLBACK_LENGTH;
  const defaultClaimedBy = deps.config?.defaultClaimedBy ?? DEFAULT_CLAIMED_BY;

  /** 1件の Observation に対して抽出を実行し、作られた（または冪等に既存の）Memory の id を返す。 */
  async function runExtraction(
    ctx: Ctx,
    observation: Observation,
  ): Promise<{ memoryIds: MemoryId[]; outcome: ExtractionOutcome }> {
    const { candidates, usedWholeObservationFallback } = await extractCandidates(
      deps.llmProvider,
      ctx,
      observation,
    );
    const outcome: ExtractionOutcome = usedWholeObservationFallback
      ? "llm_failed_whole_observation"
      : "ok";
    if (candidates.length === 0) {
      return { memoryIds: [], outcome };
    }
    const halfLifeHours = await deps.tenantSettingsStore.getDefaultHalfLifeHours(ctx);
    const now = clock.now();
    const memoryIds: MemoryId[] = [];
    for (const candidate of candidates) {
      const newMemory = buildNewMemoryFromCandidate({
        ctx,
        observation,
        candidate,
        hashContent: deps.hashContent,
        extractorVersion,
        llmModelId,
        promptVersion,
        halfLifeHours,
        now,
        digestFallbackLength,
      });
      const { memory, created } = await deps.memoryStore.createMemoryWithOutbox(ctx, newMemory, [
        "embed",
      ]);
      memoryIds.push(memory.id);
      if (created) {
        await deps.eventStore.append(ctx, {
          tenantId: ctx.tenantId,
          memoryId: memory.id,
          kind: "created",
          actor: { type: "system" },
          digestSnapshot: memory.digest,
          sizeBeforeBytes: null,
          meta: {
            reason:
              outcome === "llm_failed_whole_observation"
                ? "extraction_failed_whole_observation_fallback"
                : "extracted",
            sourceObservationId: observation.id,
            extractorVersion,
          },
        });
      }
      // embed ジョブは常に outbox 経由（非同期、docs/memory-model.md §11 行3）。
      // ここでは何もしない — tick() の processEmbedJob が処理する。
    }
    return { memoryIds, outcome };
  }

  async function handleMemoryUsage(
    ctx: Ctx,
    input: Extract<ObserveInput, { kind: "memory_usage" }>,
  ): Promise<ObserveResult> {
    const observation = await deps.memoryStore.createObservation(ctx, {
      tenantId: ctx.tenantId,
      subjectId: ctx.subjectId ?? null,
      externalId: null,
      kind: observeInputKindToObservationKind("memory_usage" satisfies ObserveInputKind),
      payload: { recallId: input.recallId, usedMemoryIds: input.usedMemoryIds },
      occurredAt: null,
      recordedAt: clock.now(),
    });

    // ADR 0009・docs/memory-model.md §6: 使用報告は抽出器を通らず recall_usages へ直接反映される。
    const { insertedMemoryIds } = await deps.memoryStore.recordUsage(
      ctx,
      input.recallId,
      input.usedMemoryIds,
    );
    const reinforcedAt = clock.now();
    for (const memoryId of insertedMemoryIds) {
      await deps.memoryStore.reinforce(ctx, memoryId, reinforcedAt);
    }

    return { observationId: observation.id, memoryIds: insertedMemoryIds, extraction: "skipped" };
  }

  async function handleExtractableObservation(
    ctx: Ctx,
    input: ObserveUtteranceInput | ObserveEventInput | ObserveDocumentInput,
  ): Promise<ObserveResult> {
    const kind = observeInputKindToObservationKind(input.kind);
    const payload = extractObservationPayload(input);
    const extractMode = input.extract ?? "sync";

    const newObservation: NewObservation = {
      tenantId: ctx.tenantId,
      subjectId: input.subjectId ?? ctx.subjectId ?? null,
      externalId: input.externalId ?? null,
      kind,
      payload,
      occurredAt: input.occurredAt ?? null,
      recordedAt: clock.now(),
    };

    const { observation, created, jobs } = await deps.memoryStore.createObservationWithOutbox(
      ctx,
      newObservation,
      ["extract"],
    );

    if (!created) {
      // 冪等な再送（docs/architecture.md §3.5）。extract ジョブは積まれておらず、
      // sync/deferred のどちらであっても、ここで新たに抽出をやり直す必要はない
      // （最初の呼び出しで既に処理済みのはず）。
      return { observationId: observation.id, memoryIds: [], extraction: "skipped" };
    }

    if (extractMode === "deferred") {
      return { observationId: observation.id, memoryIds: [], extraction: "skipped" };
    }

    // extract: 'sync' — その場で抽出する（docs/architecture.md §3.2）。
    const { memoryIds, outcome } = await runExtraction(ctx, observation);
    const extractJob = jobs.find((job) => job.kind === "extract");
    if (extractJob) {
      await deps.outboxStore.complete(ctx, extractJob.id);
    }
    return { observationId: observation.id, memoryIds, extraction: outcome };
  }

  async function observe(ctx: Ctx, input: ObserveInput): Promise<ObserveResult> {
    const parsed = ObserveInputSchema.parse(input);
    if (parsed.kind === "memory_usage") {
      return handleMemoryUsage(ctx, parsed);
    }
    return handleExtractableObservation(ctx, parsed);
  }

  async function processExtractJob(ctx: Ctx, job: OutboxJobRecord): Promise<void> {
    const observationId = job.payload.observationId;
    if (typeof observationId !== "string") {
      throw new Error("runtime.tick: extract job payload missing observationId");
    }
    const observation = await deps.memoryStore.getObservation(ctx, observationId);
    if (!observation) {
      throw new Error(`runtime.tick: extract job references missing observation: ${observationId}`);
    }
    await runExtraction(ctx, observation);
  }

  async function processEmbedJob(ctx: Ctx, job: OutboxJobRecord): Promise<void> {
    const memoryId = job.payload.memoryId;
    if (typeof memoryId !== "string") {
      throw new Error("runtime.tick: embed job payload missing memoryId");
    }
    const memory = await deps.memoryStore.get(ctx, memoryId);
    if (!memory) {
      throw new Error(`runtime.tick: embed job references missing memory: ${memoryId}`);
    }
    try {
      const [vector] = await deps.embeddingProvider.embed(ctx, [memory.content]);
      if (!vector) {
        throw new Error("runtime.tick: embedding provider returned no vector");
      }
      await deps.vectorStore.upsert(ctx, deps.embeddingProvider.space, memory.id, vector);
      await deps.memoryStore.setEmbeddingStatus(ctx, memory.id, "ready");
    } catch (err) {
      // 索引の遅れ・失敗を黙って無かったことにしない（docs/architecture.md 原則の姿3）。
      await deps.memoryStore.setEmbeddingStatus(ctx, memory.id, "failed");
      throw err;
    }
  }

  async function tick(ctx: Ctx, opts: TickOptions = {}): Promise<TickResult> {
    const claimOpts: ClaimOutboxJobsOptions = {
      kinds: opts.kinds ?? ["extract", "embed"],
      limit: opts.limit ?? DEFAULT_TICK_LIMIT,
      now: clock.now(),
      claimedBy: opts.claimedBy ?? defaultClaimedBy,
    };
    const jobs = await deps.outboxStore.claimBatch(ctx, claimOpts);

    let processed = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        if (job.kind === "extract") {
          await processExtractJob(ctx, job);
        } else if (job.kind === "embed") {
          await processEmbedJob(ctx, job);
        } else {
          throw new Error(`runtime.tick: unknown outbox job kind: ${job.kind}`);
        }
        await deps.outboxStore.complete(ctx, job.id);
        processed += 1;
      } catch (err) {
        await deps.outboxStore.fail(ctx, job.id, err instanceof Error ? err.message : String(err));
        failed += 1;
      }
    }
    return { processed, failed };
  }

  return { observe, tick };
}
