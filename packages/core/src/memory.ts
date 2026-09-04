import { z } from "zod";
import type { MemoryId, ObservationId } from "./ids.js";
import { ProvenanceSchema, type Provenance } from "./provenance.js";

export type MemoryStatus = "active" | "superseded" | "contested" | "archived" | "forgotten";

export const MemoryStatusSchema = z.enum([
  "active",
  "superseded",
  "contested",
  "archived",
  "forgotten",
]) satisfies z.ZodType<MemoryStatus>;

export type EmbeddingStatus = "pending" | "ready" | "failed" | "skipped";

export const EmbeddingStatusSchema = z.enum([
  "pending",
  "ready",
  "failed",
  "skipped",
]) satisfies z.ZodType<EmbeddingStatus>;

export type DigestSource = "llm" | "fallback";

export const DigestSourceSchema = z.enum(["llm", "fallback"]) satisfies z.ZodType<DigestSource>;

/**
 * 解釈済みの記憶単位（docs/memory-model.md §1・§10）。
 *
 * `contentHash` について（D16）: content の SHA-256 の hex 文字列とする規約。
 * **core はこの値を計算しない**（Node の `crypto` に依存させないため、
 * docs/architecture.md §3.6 の「core は zod 以外の実行時依存を持たない」を守る）。
 * 呼び出し側・adapter が `crypto.createHash('sha256').update(content).digest('hex')`
 * （またはそれと同値の実装）で計算し、`NewMemory.contentHash` に渡すこと。
 */
export interface Memory {
  id: MemoryId;
  tenantId: string;
  subjectId?: string | null;

  sourceObservationId?: ObservationId | null;
  extractorVersion?: string | null;

  content: string;
  contentHash: string;
  digest: string;
  digestSource: DigestSource;

  provenance: Provenance;

  status: MemoryStatus;
  supersededById?: MemoryId | null;
  contestedWithId?: MemoryId | null;

  tags: string[];

  occurredAt?: Date | null;
  recordedAt: Date;
  lastReinforcedAt?: Date | null;

  strength: number;
  halfLifeHours: number;
  decayFloorAt: Date;

  embeddingStatus: EmbeddingStatus;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * `createMemory` への入力。`id` / `createdAt` / `updatedAt` は store が採番する。
 *
 * `contentHash` と `decayFloorAt` は呼び出し側（runtime/adapter）が計算して渡す。
 * `decayFloorAt` は `defaultDecayStrategy.floorAt(...)` を書き込み時に一度だけ呼んで
 * 得た値を渡すこと（docs/memory-model.md §7・ADR 0010）。
 */
export type NewMemory = Omit<
  Memory,
  "id" | "createdAt" | "updatedAt" | "status" | "supersededById" | "contestedWithId"
> &
  Partial<Pick<Memory, "status" | "supersededById" | "contestedWithId">>;

export const MemorySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  subjectId: z.string().min(1).nullable().optional(),

  sourceObservationId: z.string().min(1).nullable().optional(),
  extractorVersion: z.string().min(1).nullable().optional(),

  content: z.string(),
  contentHash: z.string().min(1),
  digest: z.string().min(1),
  digestSource: DigestSourceSchema,

  provenance: ProvenanceSchema,

  status: MemoryStatusSchema,
  supersededById: z.string().min(1).nullable().optional(),
  contestedWithId: z.string().min(1).nullable().optional(),

  tags: z.array(z.string()),

  occurredAt: z.date().nullable().optional(),
  recordedAt: z.date(),
  lastReinforcedAt: z.date().nullable().optional(),

  strength: z.number(),
  halfLifeHours: z.number().positive(),
  decayFloorAt: z.date(),

  embeddingStatus: EmbeddingStatusSchema,

  createdAt: z.date(),
  updatedAt: z.date(),
}) satisfies z.ZodType<Memory>;

export const NewMemorySchema = MemorySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  supersededById: true,
  contestedWithId: true,
}).extend({
  status: MemoryStatusSchema.optional(),
  supersededById: z.string().min(1).nullable().optional(),
  contestedWithId: z.string().min(1).nullable().optional(),
}) satisfies z.ZodType<NewMemory>;
