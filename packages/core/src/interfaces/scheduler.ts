import type { Ctx } from "../ctx.js";

/**
 * outbox ジョブの種別（docs/memory-model.md §10 の `outbox.kind` 列）。
 * `observations.kind` と同様、開いた判別可能ユニオンとして扱い、CHECK 制約に
 * 相当する閉じた型を core には持たせない。
 */
export type OutboxJobKind = "extract" | "embed" | "consolidate" | "reflect" | (string & {});

export interface OutboxJob {
  id: string;
  tenantId: string;
  kind: OutboxJobKind;
  payload: Record<string, unknown>;
  availableAt?: Date;
}

/**
 * Scheduler — interface は Phase 1、既定実装は `InlineScheduler`
 * （docs/architecture.md §5.6）。BullMQ 実装は後続フェーズ。
 *
 * 契約:
 * - `enqueue` はジョブの重複投入に対して冪等でなくてよい（重複排除は消費側/extractor の
 *   冪等制約が担う）。
 */
export interface Scheduler {
  enqueue(ctx: Ctx, job: OutboxJob): Promise<void>;
}
