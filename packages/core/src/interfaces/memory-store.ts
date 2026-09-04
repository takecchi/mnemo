import type { Ctx } from "../ctx.js";
import type { MemoryId, RecallId } from "../ids.js";
import type { Memory, MemoryStatus, NewMemory } from "../memory.js";
import type { NewObservation, Observation } from "../observation.js";
import type { GroupCount, RecallScope } from "../recall.js";

/**
 * MemoryStore — Phase 1（docs/architecture.md §5.1）。
 *
 * 実装は adapter 側（`packages/postgres` 等）に置く。ここは型のみ。
 *
 * 契約（振る舞い。型からは読み取れないため、`packages/testkit` の適合テストで検査する）:
 * - `createMemory` は `(tenant_id, source_observation_id, extractor_version, content_hash)` の
 *   一意制約により冪等（docs/architecture.md §3.5）。
 * - `reinforce` は挿入が実際に起きたときだけ `last_reinforced_at` / `strength` を更新し、
 *   `decay_floor_at` を再計算する。
 * - `status = 'contested'` の Memory を単独で返してはならない。対向する Memory を
 *   スコアに関係なく必ず一緒に取得できなければならない（mandatory companion retrieval）。
 * - `countByGroup` の返り値は近似を許すが、`countKind` を必ず伴う。
 * - テナント分離: すべてのメソッドは `ctx.tenantId` に一致しない行を返してはならない。
 *   `testkit` は2テナントを同時に投入し、クロステナントの取得が0件になることを検査する。
 *
 * D9（マネージャー決定）で以下2メソッドを追加した。理由は docs/architecture.md §5.1 に
 * 追記済み:
 * - `getMany` — recall 段3の mandatory companion retrieval が `get` の連続呼び出し
 *   （N+1）にならないようにするため。
 * - `recordUsage` — 「実際に挿入が起きたときだけ強化する」という契約
 *   （docs/memory-model.md §6）を呼び出し側が知るための戻り値
 *   （`insertedMemoryIds`）を持つ。`reinforce` 単体では「実際に挿入されたか」を
 *   呼び出し側は知れない。
 */
export interface MemoryStore {
  createObservation(ctx: Ctx, input: NewObservation): Promise<Observation>;
  createMemory(ctx: Ctx, input: NewMemory): Promise<Memory>;
  get(ctx: Ctx, id: MemoryId): Promise<Memory | null>;
  /** D9: recall 段3の mandatory companion retrieval のための一括取得。 */
  getMany(ctx: Ctx, ids: MemoryId[]): Promise<Memory[]>;
  updateStatus(
    ctx: Ctx,
    id: MemoryId,
    status: MemoryStatus,
    opts?: { supersededById?: MemoryId },
  ): Promise<Memory>;
  reinforce(ctx: Ctx, id: MemoryId, at: Date): Promise<Memory>;
  /**
   * D9: 使用報告を記録する。`(recall_id, memory_id)` の挿入が実際に起きたものだけを
   * `insertedMemoryIds` として返す（再送は空配列になりうる）。
   */
  recordUsage(
    ctx: Ctx,
    recallId: RecallId,
    memoryIds: MemoryId[],
  ): Promise<{ insertedMemoryIds: MemoryId[] }>;
  countByGroup(ctx: Ctx, scope: RecallScope): Promise<GroupCount[]>;
}
