import { z } from "zod";
import type { OutboxJobKind } from "./interfaces/scheduler.js";

/**
 * `outbox` テーブルの1行を core の型として表したもの（docs/memory-model.md §10、ADR 0005）。
 *
 * `MemoryStore.createObservationWithOutbox` / `createMemoryWithOutbox` が新規作成時に返し、
 * `OutboxStore` が claim/complete/fail で操作する対象。
 */
export interface OutboxJobRecord {
  id: string;
  tenantId: string;
  kind: OutboxJobKind;
  payload: Record<string, unknown>;
  availableAt: Date;
  claimedAt?: Date | null;
  claimedBy?: string | null;
  attempts: number;
  completedAt?: Date | null;
  failedAt?: Date | null;
  lastError?: string | null;
  createdAt: Date;
}

export const OutboxJobRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  availableAt: z.date(),
  claimedAt: z.date().nullable().optional(),
  claimedBy: z.string().min(1).nullable().optional(),
  attempts: z.number().int().nonnegative(),
  completedAt: z.date().nullable().optional(),
  failedAt: z.date().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.date(),
}) satisfies z.ZodType<OutboxJobRecord>;
