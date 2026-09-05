import { describe, expect, it } from "vitest";
import type { Ctx, EventStore, MemoryId } from "@mnemo/core";
import { buildNewMemoryEventFixture } from "./test-data.js";

export interface EventStoreConformanceOptions {
  name: string;
  createStore: () => EventStore | Promise<EventStore>;
  /**
   * `memory_id` に実在の Memory を要求する adapter（`packages/postgres` の外部キー）向けの
   * フック。省略時は固定文字列を使う（外部キーを持たない in-memory 実装向け）。
   * `docs/testkit` の既定フィクスチャ（`buildNewMemoryEventFixture`）は `memoryId: null` を
   * 既定にしているため、`memoryId` を伴うテスト（list の memoryId フィルタ等）でのみ使う。
   */
  prepareMemoryId?: (ctx: Ctx) => Promise<MemoryId> | MemoryId;
}

/**
 * `EventStore` interface が `update`/`delete` を持たないことのコンパイル時の検査。
 *
 * これは実行時のテストでは検査できない——「型に無い」こと自体が担保だからである
 * （docs/memory-model.md §9: 「型に無ければ、実装が間違って消す経路がそもそも生えない」）。
 * `keyof EventStore` に `'update'` / `'delete'` が含まれていたら、この行自体が
 * コンパイルエラーになる。
 */
type _EventStoreHasNoUpdateOrDelete = "update" extends keyof EventStore
  ? "EventStore に update を持たせてはならない（docs/memory-model.md §9）"
  : "delete" extends keyof EventStore
    ? "EventStore に delete を持たせてはならない（docs/memory-model.md §9）"
    : true;
const _eventStoreShapeCheck: _EventStoreHasNoUpdateOrDelete = true;

/**
 * `EventStore` の適合テスト（docs/architecture.md §5.8、docs/memory-model.md §9）。
 *
 * 検査する契約:
 * - append-only（型・実行時オブジェクトの両方で update/delete が存在しない）
 * - append した event が get/list で取得できる
 * - テナント分離（get/list とも他テナントの行を返さない）
 * - list の kind フィルタ・memoryId フィルタ
 */
export function describeEventStoreConformance(options: EventStoreConformanceOptions): void {
  const { name, createStore } = options;
  let fixtureMemoryIdCounter = 0;
  const prepareMemoryId: (ctx: Ctx) => Promise<MemoryId> | MemoryId =
    options.prepareMemoryId ?? (() => `mem-fixture-${(fixtureMemoryIdCounter += 1)}`);

  describe(`EventStore conformance (${name})`, () => {
    it("append した実装オブジェクトに update/delete メソッドが生えていない（実装側の実行時の念のための確認）", async () => {
      const store = await createStore();
      expect((store as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((store as unknown as Record<string, unknown>).delete).toBeUndefined();
    });

    it("append した event が get で取得できる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };

      const appended = await store.append(
        ctx,
        buildNewMemoryEventFixture({ tenantId: "tenant-1" }),
      );
      const fetched = await store.get(ctx, appended.id);

      expect(fetched?.id).toBe(appended.id);
    });

    it("クロステナントの get は null になる", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };

      const appended = await store.append(
        ctxA,
        buildNewMemoryEventFixture({ tenantId: "tenant-a" }),
      );
      const crossTenantRead = await store.get(ctxB, appended.id);

      expect(crossTenantRead).toBeNull();
    });

    it("list は kind でフィルタできる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };

      await store.append(
        ctx,
        buildNewMemoryEventFixture({ tenantId: "tenant-1", kind: "created" }),
      );
      await store.append(
        ctx,
        buildNewMemoryEventFixture({ tenantId: "tenant-1", kind: "forgotten" }),
      );

      const created = await store.list(ctx, { kind: "created" });

      expect(created.every((event) => event.kind === "created")).toBe(true);
      expect(created.length).toBeGreaterThanOrEqual(1);
    });

    it("list は memoryId でフィルタできる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memoryId = await prepareMemoryId(ctx);
      const otherMemoryId = await prepareMemoryId(ctx);

      await store.append(
        ctx,
        buildNewMemoryEventFixture({ tenantId: "tenant-1", memoryId, kind: "created" }),
      );
      await store.append(
        ctx,
        buildNewMemoryEventFixture({
          tenantId: "tenant-1",
          memoryId: otherMemoryId,
          kind: "created",
        }),
      );

      const filtered = await store.list(ctx, { memoryId });
      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(filtered.every((event) => event.memoryId === memoryId)).toBe(true);
    });

    it("クロステナントの list は他テナントのイベントを含まない", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };

      await store.append(ctxA, buildNewMemoryEventFixture({ tenantId: "tenant-a" }));

      const listB = await store.list(ctxB, {});
      expect(listB).toEqual([]);
    });
  });
}
