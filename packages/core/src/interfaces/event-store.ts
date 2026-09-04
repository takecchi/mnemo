import type { Ctx } from "../ctx.js";
import type { EventId } from "../ids.js";
import type { EventFilter, MemoryEvent, NewMemoryEvent } from "../event.js";

/**
 * EventStore — Phase 1（監査ログ、docs/architecture.md §5.8）。
 *
 * **`update` / `delete` を意図的に持たせない。** append-only。alteroid の `JournalStore`
 * と同じ形——型に無ければ、実装が間違って消す経路がそもそも生えない、という静的な担保
 * （docs/memory-model.md §9）。
 */
export interface EventStore {
  append(ctx: Ctx, event: NewMemoryEvent): Promise<MemoryEvent>;
  get(ctx: Ctx, id: EventId): Promise<MemoryEvent | null>;
  list(ctx: Ctx, filter: EventFilter): Promise<MemoryEvent[]>;
}
