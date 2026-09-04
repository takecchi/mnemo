import { describe, expect, it } from "vitest";
import type { Ctx, MemoryStore } from "@mnemo/core";
import { buildNewMemoryFixture } from "./test-data.js";

export interface MemoryStoreConformanceOptions {
  /** テスト出力に出す adapter 名（例: "postgres", "in-memory"）。 */
  name: string;
  /** テストケースごとに独立した状態を持つ新しい MemoryStore を返す。 */
  createStore: () => MemoryStore | Promise<MemoryStore>;
}

/**
 * `MemoryStore` の適合テスト（docs/architecture.md §5.1・§3.7）。
 *
 * ここでの契約は「型」ではなく「振る舞い」である。型はすでに TypeScript が検査するが、
 * 冪等性・テナント分離のような振る舞いは実行しないと検査できない
 * （roadmap.md 段階1の完了条件: 「testkit の適合テストの雛形が、プレースホルダ実装に
 * 対して動く」）。
 *
 * Phase 1 の段階1では雛形であることを優先し、docs/architecture.md §5.1 が明記する契約の
 * うち以下を実際に検査する:
 * - 2テナント分のデータを投入し、クロステナントの取得が0件になること（§3.7 必須契約）
 * - `createMemory` の冪等性（§3.5）
 * - `recordUsage` の冪等性（D9・§3.5「挿入の成否で数える」）
 *
 * `updateStatus` の mandatory companion retrieval や `countByGroup` の近似許可などは
 * 段階4・5（recall 実装）で adapter が揃ってから、より実データに近い形で拡充する。
 */
export function describeMemoryStoreConformance(options: MemoryStoreConformanceOptions): void {
  const { name, createStore } = options;

  describe(`MemoryStore conformance (${name})`, () => {
    it("2テナント分のデータを投入すると、クロステナントの get は null になる", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };

      const memoryA = await store.createMemory(
        ctxA,
        buildNewMemoryFixture({ tenantId: "tenant-a" }),
      );
      await store.createMemory(ctxB, buildNewMemoryFixture({ tenantId: "tenant-b" }));

      const crossTenantRead = await store.get(ctxB, memoryA.id);
      expect(crossTenantRead).toBeNull();

      const sameTenantRead = await store.get(ctxA, memoryA.id);
      expect(sameTenantRead?.id).toBe(memoryA.id);
    });

    it("2テナント分のデータを投入すると、クロステナントの countByGroup は0件になる", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };

      await store.createMemory(ctxA, buildNewMemoryFixture({ tenantId: "tenant-a" }));

      const groupsB = await store.countByGroup(ctxB, {});
      const totalB = groupsB.reduce((sum, group) => sum + group.count, 0);
      expect(totalB).toBe(0);
    });

    it("2テナント分のデータを投入すると、クロステナントの getMany は空配列になる", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };

      const memoryA = await store.createMemory(
        ctxA,
        buildNewMemoryFixture({ tenantId: "tenant-a" }),
      );

      const crossTenantRead = await store.getMany(ctxB, [memoryA.id]);
      expect(crossTenantRead).toEqual([]);
    });

    it("createMemory は同じ抽出キーに対して冪等である（重複を作らない）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const input = buildNewMemoryFixture({
        tenantId: "tenant-1",
        sourceObservationId: "obs-shared",
        extractorVersion: "v1",
        contentHash: "same-hash",
      });

      const first = await store.createMemory(ctx, input);
      const second = await store.createMemory(ctx, input);

      expect(second.id).toBe(first.id);
    });

    it("createMemory は sourceObservationId/contentHash が異なれば別の Memory を作る", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const first = await store.createMemory(
        ctx,
        buildNewMemoryFixture({
          tenantId: "tenant-1",
          sourceObservationId: "obs-1",
          extractorVersion: "v1",
          contentHash: "hash-1",
        }),
      );
      const second = await store.createMemory(
        ctx,
        buildNewMemoryFixture({
          tenantId: "tenant-1",
          sourceObservationId: "obs-2",
          extractorVersion: "v1",
          contentHash: "hash-2",
        }),
      );

      expect(second.id).not.toBe(first.id);
    });

    it("recordUsage は同じ (recallId, memoryId) の再送に対して冪等である（D9）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memory = await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: "tenant-1" }));

      const first = await store.recordUsage(ctx, "recall-1", [memory.id]);
      expect(first.insertedMemoryIds).toEqual([memory.id]);

      const second = await store.recordUsage(ctx, "recall-1", [memory.id]);
      expect(second.insertedMemoryIds).toEqual([]);
    });

    it("reinforce は last_reinforced_at と decay_floor_at を更新する", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memory = await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: "tenant-1" }));
      const before = memory.decayFloorAt.getTime();

      const reinforcedAt = new Date(memory.recordedAt.getTime() + 1000 * 60 * 60 * 24 * 30);
      const reinforced = await store.reinforce(ctx, memory.id, reinforcedAt);

      expect(reinforced.lastReinforcedAt?.getTime()).toBe(reinforcedAt.getTime());
      expect(reinforced.decayFloorAt.getTime()).not.toBe(before);
    });

    it("updateStatus は status を更新し、supersededById を任意で設定できる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const oldMemory = await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1" }),
      );
      const newMemory = await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1" }),
      );

      const updated = await store.updateStatus(ctx, oldMemory.id, "superseded", {
        supersededById: newMemory.id,
      });

      expect(updated.status).toBe("superseded");
      expect(updated.supersededById).toBe(newMemory.id);
    });
  });
}
