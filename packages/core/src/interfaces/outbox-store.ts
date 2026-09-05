import type { Ctx } from "../ctx.js";
import type { OutboxJobRecord } from "../outbox.js";
import type { OutboxJobKind } from "./scheduler.js";

/**
 * OutboxStore — Phase 1（本 PR で追加。docs/architecture.md §3.4・ADR 0005 の
 * transactional outbox パターンの「運搬役」側）。
 *
 * `MemoryStore.createObservationWithOutbox` / `createMemoryWithOutbox` が
 * Observation/Memory の作成と同一トランザクションで `outbox` へジョブを書く一方、
 * `OutboxStore` はその後の「未処理行を claim して処理し、完了/失敗を記録する」側を担う。
 * `runtime.tick(ctx, opts)`（docs/architecture.md §3.3）がこの interface を使う。
 *
 * 契約:
 * - `claimBatch` は同時に複数のワーカーから呼ばれても同じジョブを二重に claim してはならない
 *   （adapter 実装は `SELECT ... FOR UPDATE SKIP LOCKED` 相当で保証する）。
 * - `claimBatch` が返すジョブは `completed_at IS NULL AND failed_at IS NULL` かつ
 *   `available_at <= now` のものに限る。
 * - `complete` / `fail` は対象が既に完了/失敗していても例外を投げない（べき等な終端更新）。
 * - Phase 1 では失敗したジョブの自動リトライを行わない（`fail` は終端状態。本 PR の決定、
 *   PR 本文に記載）。
 */
export interface ClaimOutboxJobsOptions {
  kinds?: OutboxJobKind[];
  limit: number;
  now: Date;
  claimedBy: string;
}

export interface OutboxStore {
  claimBatch(ctx: Ctx, opts: ClaimOutboxJobsOptions): Promise<OutboxJobRecord[]>;
  complete(ctx: Ctx, jobId: string): Promise<void>;
  fail(ctx: Ctx, jobId: string, error: string): Promise<void>;
}
