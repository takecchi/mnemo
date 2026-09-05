import { z } from "zod";
import type { MemoryId, RecallId } from "./ids.js";
import type { ProvenanceKind } from "./provenance.js";

/**
 * 件数そのものの「無いの種類」（docs/recall.md §4）。
 * 推定値を実測値の顔で出さない、という原則の実装。
 */
export type CountKind = "exact" | "lower_bound" | "unknown";

export const CountKindSchema = z.enum([
  "exact",
  "lower_bound",
  "unknown",
]) satisfies z.ZodType<CountKind>;

// ---------------------------------------------------------------------------
// Omission（docs/recall.md §4、ADR 0008）
// ---------------------------------------------------------------------------

export interface StageSkippedOmission {
  kind: "stage_skipped";
  stage: "candidate_generation" | "rescore" | "index_band";
  reason: "embedding_provider_unavailable" | "empty_query_content" | "budget_exhausted";
}

export interface FilteredOmission {
  kind: "filtered";
  condition: "tenant" | "status" | "archived" | "taxonomy" | "period";
  count: number;
  countKind: CountKind;
}

export interface BelowThresholdOmission {
  kind: "below_threshold";
  count: number;
  countKind: CountKind;
  nearMisses?: { memoryId: MemoryId; score: number }[];
}

export interface OverLimitOmission {
  kind: "over_limit";
  count: number;
  countKind: CountKind;
}

export interface BudgetDroppedOmission {
  kind: "budget_dropped";
  count: number;
  countKind: CountKind;
}

export interface NotIndexedOmission {
  kind: "not_indexed";
  count: number;
  countKind: CountKind;
}

export interface AnnTruncatedOmission {
  kind: "ann_truncated";
  countKind: "unknown";
}

export type Omission =
  | StageSkippedOmission
  | FilteredOmission
  | BelowThresholdOmission
  | OverLimitOmission
  | BudgetDroppedOmission
  | NotIndexedOmission
  | AnnTruncatedOmission;

const StageSkippedOmissionSchema = z.object({
  kind: z.literal("stage_skipped"),
  stage: z.enum(["candidate_generation", "rescore", "index_band"]),
  reason: z.enum(["embedding_provider_unavailable", "empty_query_content", "budget_exhausted"]),
}) satisfies z.ZodType<StageSkippedOmission>;

const FilteredOmissionSchema = z.object({
  kind: z.literal("filtered"),
  condition: z.enum(["tenant", "status", "archived", "taxonomy", "period"]),
  count: z.number().int().nonnegative(),
  countKind: CountKindSchema,
}) satisfies z.ZodType<FilteredOmission>;

const BelowThresholdOmissionSchema = z.object({
  kind: z.literal("below_threshold"),
  count: z.number().int().nonnegative(),
  countKind: CountKindSchema,
  nearMisses: z.array(z.object({ memoryId: z.string().min(1), score: z.number() })).optional(),
}) satisfies z.ZodType<BelowThresholdOmission>;

const OverLimitOmissionSchema = z.object({
  kind: z.literal("over_limit"),
  count: z.number().int().nonnegative(),
  countKind: CountKindSchema,
}) satisfies z.ZodType<OverLimitOmission>;

const BudgetDroppedOmissionSchema = z.object({
  kind: z.literal("budget_dropped"),
  count: z.number().int().nonnegative(),
  countKind: CountKindSchema,
}) satisfies z.ZodType<BudgetDroppedOmission>;

const NotIndexedOmissionSchema = z.object({
  kind: z.literal("not_indexed"),
  count: z.number().int().nonnegative(),
  countKind: CountKindSchema,
}) satisfies z.ZodType<NotIndexedOmission>;

const AnnTruncatedOmissionSchema = z.object({
  kind: z.literal("ann_truncated"),
  countKind: z.literal("unknown"),
}) satisfies z.ZodType<AnnTruncatedOmission>;

export const OmissionSchema = z.discriminatedUnion("kind", [
  StageSkippedOmissionSchema,
  FilteredOmissionSchema,
  BelowThresholdOmissionSchema,
  OverLimitOmissionSchema,
  BudgetDroppedOmissionSchema,
  NotIndexedOmissionSchema,
  AnnTruncatedOmissionSchema,
]);

// ---------------------------------------------------------------------------
// 目次帯 / 被覆不変条件（docs/recall.md §5）
// ---------------------------------------------------------------------------

/**
 * D12: `key` は `string | null` にする。`subject_id IS NULL` の群を表すため。
 * `'(none)'` のような番兵文字列は実在する subject 名と衝突しうるので採らない。
 */
export interface GroupCount {
  axis: "subject" | "taxonomy" | "time_window";
  key: string | null;
  count: number;
  countKind: CountKind;
}

export const GroupCountSchema = z.object({
  axis: z.enum(["subject", "taxonomy", "time_window"]),
  key: z.string().nullable(),
  count: z.number().int().nonnegative(),
  countKind: CountKindSchema,
}) satisfies z.ZodType<GroupCount>;

/** Phase 2 の digest 帯（recall.md §5）。Phase 1 では型だけ持ち、常に undefined。 */
export interface DigestEntry {
  memoryId: MemoryId;
  digest: string;
}

export const DigestEntrySchema = z.object({
  memoryId: z.string().min(1),
  digest: z.string(),
}) satisfies z.ZodType<DigestEntry>;

export interface IndexBand {
  groups: GroupCount[];
  totalInScope: number;
  countKind: CountKind;
  /** Phase 2。Phase 1 では常に undefined。 */
  digestBand?: DigestEntry[];
}

export const IndexBandSchema = z.object({
  groups: z.array(GroupCountSchema),
  totalInScope: z.number().int().nonnegative(),
  countKind: CountKindSchema,
  digestBand: z.array(DigestEntrySchema).optional(),
}) satisfies z.ZodType<IndexBand>;

// ---------------------------------------------------------------------------
// 量の計測と予算（docs/recall.md §6）
// ---------------------------------------------------------------------------

export interface RecallUsage {
  chars: number;
  estimatedTokens: number;
  counter: "heuristic" | "exact";
  byTier: { full: number; digest: number; index: number };
  /** budget が申告されている場合のみ: usage / budget */
  share?: number;
}

export const RecallUsageSchema = z.object({
  chars: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  counter: z.enum(["heuristic", "exact"]),
  byTier: z.object({
    full: z.number().int().nonnegative(),
    digest: z.number().int().nonnegative(),
    index: z.number().int().nonnegative(),
  }),
  share: z.number().nonnegative().optional(),
}) satisfies z.ZodType<RecallUsage>;

export interface RecallBudget {
  maxChars?: number;
  maxTokens?: number;
  promptBudgetTokens?: number;
}

export const RecallBudgetSchema = z.object({
  maxChars: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  promptBudgetTokens: z.number().int().positive().optional(),
}) satisfies z.ZodType<RecallBudget>;

// ---------------------------------------------------------------------------
// スコア内訳（docs/recall.md §7）
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  /** ANN 経由でのみ存在。距離から変換した類似度。 */
  similarity?: number;
  decay: number;
  tagMatch: number;
  freshness: number;
  strength: number;
  total: number;
}

export const ScoreBreakdownSchema = z.object({
  similarity: z.number().optional(),
  decay: z.number(),
  tagMatch: z.number(),
  freshness: z.number(),
  strength: z.number(),
  total: z.number(),
}) satisfies z.ZodType<ScoreBreakdown>;

export interface RecalledMemory {
  memoryId: MemoryId;
  digest: string;
  retrievedVia: "ann" | "tag_match" | "recency" | "mandatory_companion";
  /** 矛盾の相手として同伴取得された場合、その相手の memoryId。 */
  companionOf?: MemoryId;
  score: ScoreBreakdown;
}

export const RecalledMemorySchema = z.object({
  memoryId: z.string().min(1),
  digest: z.string(),
  retrievedVia: z.enum(["ann", "tag_match", "recency", "mandatory_companion"]),
  companionOf: z.string().min(1).optional(),
  score: ScoreBreakdownSchema,
}) satisfies z.ZodType<RecalledMemory>;

// ---------------------------------------------------------------------------
// パイプラインのトレース（docs/recall.md §2）
// ---------------------------------------------------------------------------

export type RecallStageName =
  | "scope"
  | "candidate_generation"
  | "rescore"
  | "contradiction_resolution"
  | "budget_truncation"
  | "index_band"
  | "record";

export interface StageTrace {
  stage: RecallStageName;
  executed: boolean;
  detail?: Record<string, unknown>;
}

export const StageTraceSchema = z.object({
  stage: z.enum([
    "scope",
    "candidate_generation",
    "rescore",
    "contradiction_resolution",
    "budget_truncation",
    "index_band",
    "record",
  ]),
  executed: z.boolean(),
  detail: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<StageTrace>;

// ---------------------------------------------------------------------------
// RecallQuery / RecallResult（docs/recall.md §1）
// ---------------------------------------------------------------------------

/**
 * `recall()` への入力。
 *
 * docs/recall.md はパイプラインの段（§2）と各種オプションの効果を規定するが、
 * `RecallQuery` 自体の網羅的な型は明記していない。ここでの型は、各段の記述
 * （スコープ確定・候補生成・予算・countKind の近似許可）から素直に導いたもので、
 * フィールド名は本 PR の裁量である。
 *
 * D5: 既定で `provenance.kind = 'inferred'` を含める。除外する場合は
 * `excludeProvenanceKinds` に `['inferred']` を渡す。
 */
export interface RecallQuery {
  text?: string;
  vector?: number[];
  tags?: string[];
  occurredAfter?: Date;
  occurredBefore?: Date;
  limit?: number;
  overFetchFactor?: number;
  /** D5: recall は既定で inferred を含める。除外したい provenance.kind を明示する。 */
  excludeProvenanceKinds?: ProvenanceKind[];
  budget?: RecallBudget;
  /**
   * 目次帯（第3階)の厳密カウントを要求するか。既定は近似許可（false）
   * （docs/recall.md §5「既定は近似許可」）。
   */
  exactCounts?: boolean;
}

export const RecallQuerySchema = z.object({
  text: z.string().min(1).optional(),
  vector: z.array(z.number()).optional(),
  tags: z.array(z.string()).optional(),
  occurredAfter: z.date().optional(),
  occurredBefore: z.date().optional(),
  limit: z.number().int().positive().optional(),
  overFetchFactor: z.number().positive().optional(),
  excludeProvenanceKinds: z
    .array(z.enum(["stated", "inferred", "consolidated", "reflected", "imported"]))
    .optional(),
  budget: RecallBudgetSchema.optional(),
  exactCounts: z.boolean().optional(),
}) satisfies z.ZodType<RecallQuery>;

/**
 * `countByGroup` に渡すスコープ。docs/architecture.md §5.1 は型を明記していないため、
 * §2 の段0（スコープ確定）・段5（目次帯は段0のスコープ全体を使う）の記述から
 * 素直に導いた最小限の型を置く。
 */
export interface RecallScope {
  subjectId?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
}

export const RecallScopeSchema = z.object({
  subjectId: z.string().min(1).optional(),
  occurredAfter: z.date().optional(),
  occurredBefore: z.date().optional(),
}) satisfies z.ZodType<RecallScope>;

export interface RecallResult {
  /** 記録された recall の識別子。observe() の usage 報告で使う。 */
  recallId: RecallId;
  memories: RecalledMemory[];
  omitted: Omission[];
  index: IndexBand;
  usage: RecallUsage;
  explain: { stages: StageTrace[] };
}

export const RecallResultSchema = z.object({
  recallId: z.string().min(1),
  memories: z.array(RecalledMemorySchema),
  omitted: z.array(OmissionSchema),
  index: IndexBandSchema,
  usage: RecallUsageSchema,
  explain: z.object({ stages: z.array(StageTraceSchema) }),
}) satisfies z.ZodType<RecallResult>;
