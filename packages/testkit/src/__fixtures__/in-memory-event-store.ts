import type {
  Ctx,
  EventFilter,
  EventId,
  EventStore,
  MemoryEvent,
  NewMemoryEvent,
} from "@mnemo/core";
import { nextId } from "./id.js";

/**
 * `EventStore` のインメモリ・プレースホルダ実装。append-only を実装としても徹底する
 * （`update`/`delete` に相当するメソッドを持たない）。
 */
export class InMemoryEventStore implements EventStore {
  private readonly events: MemoryEvent[] = [];

  async append(ctx: Ctx, event: NewMemoryEvent): Promise<MemoryEvent> {
    const stored: MemoryEvent = {
      id: nextId("evt"),
      tenantId: ctx.tenantId,
      memoryId: event.memoryId,
      kind: event.kind,
      at: event.at ?? new Date(),
      actor: event.actor,
      digestSnapshot: event.digestSnapshot ?? null,
      sizeBeforeBytes: event.sizeBeforeBytes ?? null,
      meta: event.meta,
    };
    this.events.push(stored);
    return stored;
  }

  async get(ctx: Ctx, id: EventId): Promise<MemoryEvent | null> {
    const event = this.events.find((e) => e.id === id);
    if (!event || event.tenantId !== ctx.tenantId) {
      return null;
    }
    return event;
  }

  async list(ctx: Ctx, filter: EventFilter): Promise<MemoryEvent[]> {
    const matched = this.events.filter((event) => {
      if (event.tenantId !== ctx.tenantId) {
        return false;
      }
      if (filter.memoryId !== undefined && event.memoryId !== filter.memoryId) {
        return false;
      }
      if (filter.kind !== undefined && event.kind !== filter.kind) {
        return false;
      }
      if (filter.since !== undefined && event.at < filter.since) {
        return false;
      }
      if (filter.until !== undefined && event.at > filter.until) {
        return false;
      }
      return true;
    });
    return filter.limit !== undefined ? matched.slice(0, filter.limit) : matched;
  }
}
