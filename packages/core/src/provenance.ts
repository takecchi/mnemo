import { z } from "zod";

/**
 * Memory がどこから来たかを表す判別可能ユニオン（docs/memory-model.md §2）。
 *
 * オーナーの原則7「AI の推論とユーザーが言った事実を区別する」は、追加のフラグではなく
 * `kind` の値そのものとして実装される。
 */
export type ProvenanceKind = "stated" | "inferred" | "consolidated" | "reflected" | "imported";

export interface StatedProvenance {
  kind: "stated";
  sourceObservationId: string;
  speaker?: string;
  at: string;
}

export interface InferredProvenance {
  kind: "inferred";
  model: string;
  promptVersion: string;
  basis: { memoryIds: string[]; observationIds: string[] };
  confidence: number;
}

export interface ConsolidatedProvenance {
  kind: "consolidated";
  sources: string[]; // memoryIds
}

export interface ReflectedProvenance {
  kind: "reflected";
  sources?: string[]; // memoryIds, 省略可
}

export interface ImportedProvenance {
  kind: "imported";
  batchId: string;
}

export type Provenance =
  | StatedProvenance
  | InferredProvenance
  | ConsolidatedProvenance
  | ReflectedProvenance
  | ImportedProvenance;

const StatedProvenanceSchema = z.object({
  kind: z.literal("stated"),
  sourceObservationId: z.string().min(1),
  speaker: z.string().min(1).optional(),
  at: z.string().min(1),
}) satisfies z.ZodType<StatedProvenance>;

const InferredProvenanceSchema = z.object({
  kind: z.literal("inferred"),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  basis: z.object({
    memoryIds: z.array(z.string().min(1)),
    observationIds: z.array(z.string().min(1)),
  }),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<InferredProvenance>;

const ConsolidatedProvenanceSchema = z.object({
  kind: z.literal("consolidated"),
  sources: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<ConsolidatedProvenance>;

const ReflectedProvenanceSchema = z.object({
  kind: z.literal("reflected"),
  sources: z.array(z.string().min(1)).optional(),
}) satisfies z.ZodType<ReflectedProvenance>;

const ImportedProvenanceSchema = z.object({
  kind: z.literal("imported"),
  batchId: z.string().min(1),
}) satisfies z.ZodType<ImportedProvenance>;

export const ProvenanceSchema = z.discriminatedUnion("kind", [
  StatedProvenanceSchema,
  InferredProvenanceSchema,
  ConsolidatedProvenanceSchema,
  ReflectedProvenanceSchema,
  ImportedProvenanceSchema,
]);
