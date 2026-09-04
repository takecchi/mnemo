import { z } from "zod";
import type { EventId, MemoryId } from "./ids.js";

/**
 * 監査ログのイベント種別（docs/memory-model.md §9）。
 * 「状態が実際に変わった大分類」だけを列挙し、理由の粒度は `meta` に落とす。
 */
export type MemoryEventKind =
  "created" | "updated" | "superseded" | "archived" | "forgotten" | "purged" | "events_purged";

export const MemoryEventKindSchema = z.enum([
  "created",
  "updated",
  "superseded",
  "archived",
  "forgotten",
  "purged",
  "events_purged",
]) satisfies z.ZodType<MemoryEventKind>;

export interface EventActor {
  type: "human" | "system" | "clone";
  id?: string;
}

export const EventActorSchema = z.object({
  type: z.enum(["human", "system", "clone"]),
  id: z.string().min(1).optional(),
}) satisfies z.ZodType<EventActor>;

/**
 * append-only な監査ログの1行（docs/memory-model.md §9）。
 * `EventStore` interface が `update`/`delete` を持たないことと対になる型。
 */
export interface MemoryEvent {
  id: EventId;
  tenantId: string;
  /** `kind = 'events_purged'` の場合のみ null。 */
  memoryId: MemoryId | null;
  kind: MemoryEventKind;
  at: Date;
  actor: EventActor;
  digestSnapshot?: string | null;
  sizeBeforeBytes?: number | null;
  meta: Record<string, unknown>;
}

export const MemoryEventSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    memoryId: z.string().min(1).nullable(),
    kind: MemoryEventKindSchema,
    at: z.date(),
    actor: EventActorSchema,
    digestSnapshot: z.string().nullable().optional(),
    sizeBeforeBytes: z.number().int().nonnegative().nullable().optional(),
    meta: z.record(z.string(), z.unknown()),
  })
  .refine((event) => event.kind !== "events_purged" || event.memoryId === null, {
    message: "events_purged のイベントは memoryId が null でなければならない",
    path: ["memoryId"],
  }) satisfies z.ZodType<MemoryEvent>;

export type NewMemoryEvent = Omit<MemoryEvent, "id" | "at"> & { at?: Date };

export const NewMemoryEventSchema = z
  .object({
    tenantId: z.string().min(1),
    memoryId: z.string().min(1).nullable(),
    kind: MemoryEventKindSchema,
    at: z.date().optional(),
    actor: EventActorSchema,
    digestSnapshot: z.string().nullable().optional(),
    sizeBeforeBytes: z.number().int().nonnegative().nullable().optional(),
    meta: z.record(z.string(), z.unknown()),
  })
  .refine((event) => event.kind !== "events_purged" || event.memoryId === null, {
    message: "events_purged のイベントは memoryId が null でなければならない",
    path: ["memoryId"],
  }) satisfies z.ZodType<NewMemoryEvent>;

export interface EventFilter {
  memoryId?: MemoryId;
  kind?: MemoryEventKind;
  since?: Date;
  until?: Date;
  limit?: number;
}

export const EventFilterSchema = z.object({
  memoryId: z.string().min(1).optional(),
  kind: MemoryEventKindSchema.optional(),
  since: z.date().optional(),
  until: z.date().optional(),
  limit: z.number().int().positive().optional(),
}) satisfies z.ZodType<EventFilter>;
