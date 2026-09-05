import { describe, expect, it } from "vitest";
import type { Ctx, MemoryStore, RecallId } from "@mnemo/core";
import { buildNewMemoryFixture, buildNewObservationFixture } from "./test-data.js";

export interface MemoryStoreConformanceOptions {
  /** テスト出力に出す adapter 名（例: "postgres", "in-memory"）。 */
  name: string;
  /** テストケースごとに独立した状態を持つ新しい MemoryStore を返す。 */
  createStore: () => MemoryStore | Promise<MemoryStore>;
  /**
   * `recordUsage` を呼ぶ前に、有効な `recallId` を用意する必要がある adapter のためのフック。
   *
   * docs/memory-model.md §10 の DDL は `recall_usages.recall_id` を `recalls(id)` への
   * 外部キーにしている。`MemoryStore` interface 自体には「recall を記録する」操作が無い
   * （それは recall() の実装、roadmap.md 段階4の責務）ため、この適合テストは
   * `recordUsage` を単体で検査する際に使う `recallId` をどう用意するかを adapter に委ねる。
   * 省略時は固定文字列を使う（外部キーを持たない in-memory 実装向け）。
   */
  prepareRecallId?: (ctx: Ctx) => Promise<RecallId> | RecallId;
}

/**
 * `MemoryStore` の適合テスト（docs/architecture.md §5.1・§3.7）。
 *
 * ここでの契約は「型」ではなく「振る舞い」である。以下を実際に検査する:
 * - 2テナント分のデータを投入し、クロステナントの取得（get/getMany/countByGroup/
 *   updateStatus/reinforce）がクロステナントとして扱われること（§3.7 必須契約）
 * - `createObservation` の冪等性（externalId の有無・一致/不一致の各分岐）
 * - `createMemory` の冪等性（§3.5、抽出キーの一致・不一致・sourceObservationId 無しの各分岐）
 * - `recordUsage` が実際に挿入が起きたときだけ `insertedMemoryIds` に載ること
 *   （D9・§3.5、全件新規/全件再送/部分再送/空配列の各分岐）
 * - `reinforce` / `updateStatus` の正常系と「対象が無い」異常系
 * - `countByGroup` の集計が実データを反映すること
 */
export function describeMemoryStoreConformance(options: MemoryStoreConformanceOptions): void {
  const { name, createStore } = options;
  const prepareRecallId: (ctx: Ctx) => Promise<RecallId> | RecallId =
    options.prepareRecallId ?? (() => "recall-1");

  describe(`MemoryStore conformance (${name})`, () => {
    // -------------------------------------------------------------------
    // テナント分離（docs/architecture.md §3.7）
    // -------------------------------------------------------------------

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

    it("クロステナントの updateStatus/reinforce は対象が無いものとして失敗する", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };
      const memoryA = await store.createMemory(
        ctxA,
        buildNewMemoryFixture({ tenantId: "tenant-a" }),
      );

      await expect(store.updateStatus(ctxB, memoryA.id, "archived")).rejects.toThrow();
      await expect(store.reinforce(ctxB, memoryA.id, new Date())).rejects.toThrow();
    });

    // -------------------------------------------------------------------
    // createObservation の冪等性（docs/memory-model.md §10、observe() の再送）
    // -------------------------------------------------------------------

    it("createObservation は externalId が同じなら同じ Observation を返す（冪等）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const input = buildNewObservationFixture({ tenantId: "tenant-1", externalId: "ext-shared" });

      const first = await store.createObservation(ctx, input);
      const second = await store.createObservation(ctx, {
        ...input,
        payload: { text: "違うペイロード（無視されるべき）" },
      });

      expect(second.id).toBe(first.id);
    });

    it("createObservation は externalId が無ければ常に新しい Observation を作る", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const input = buildNewObservationFixture({ tenantId: "tenant-1", externalId: null });

      const first = await store.createObservation(ctx, input);
      const second = await store.createObservation(ctx, input);

      expect(second.id).not.toBe(first.id);
    });

    it("createObservation は externalId が異なれば別の Observation を作る", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };

      const first = await store.createObservation(
        ctx,
        buildNewObservationFixture({ tenantId: "tenant-1", externalId: "ext-1" }),
      );
      const second = await store.createObservation(
        ctx,
        buildNewObservationFixture({ tenantId: "tenant-1", externalId: "ext-2" }),
      );

      expect(second.id).not.toBe(first.id);
    });

    // -------------------------------------------------------------------
    // createMemory の冪等性（docs/architecture.md §3.5、§5.1）
    // -------------------------------------------------------------------

    it("createMemory は同じ抽出キーに対して冪等である（重複を作らない）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const observation = await store.createObservation(
        ctx,
        buildNewObservationFixture({ tenantId: "tenant-1" }),
      );
      const input = buildNewMemoryFixture({
        tenantId: "tenant-1",
        sourceObservationId: observation.id,
        extractorVersion: "v1",
        contentHash: "same-hash",
      });

      const first = await store.createMemory(ctx, input);
      const second = await store.createMemory(ctx, {
        ...input,
        content: "違う本文（無視され、first の内容が正になるべき）",
      });

      expect(second.id).toBe(first.id);
      expect(second.content).toBe(first.content);
    });

    it("createMemory は sourceObservationId/contentHash が異なれば別の Memory を作る", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const observationA = await store.createObservation(
        ctx,
        buildNewObservationFixture({ tenantId: "tenant-1" }),
      );
      const observationB = await store.createObservation(
        ctx,
        buildNewObservationFixture({ tenantId: "tenant-1" }),
      );
      const first = await store.createMemory(
        ctx,
        buildNewMemoryFixture({
          tenantId: "tenant-1",
          sourceObservationId: observationA.id,
          extractorVersion: "v1",
          contentHash: "hash-1",
        }),
      );
      const second = await store.createMemory(
        ctx,
        buildNewMemoryFixture({
          tenantId: "tenant-1",
          sourceObservationId: observationB.id,
          extractorVersion: "v1",
          contentHash: "hash-2",
        }),
      );

      expect(second.id).not.toBe(first.id);
    });

    it("createMemory は extractorVersion が null でも冪等である（同じ Observation・同じ contentHash で重複を作らない）", async () => {
      // docs/memory-model.md §10 の一意制約は
      //   (tenant_id, source_observation_id, extractor_version, content_hash)
      //   WHERE source_observation_id IS NOT NULL
      // だが、Postgres は既定で NULL 同士を「異なる値」として扱うため、
      // extractor_version が NULL だと**この一意制約が発火しない**。
      // 実測（PG18.6）: extractor_version = NULL で同じ行を2回入れると2行できた。
      // roadmap.md 段階3 の完了条件「同じ Observation を二重に送っても Memory が
      // 重複して作られない」が、この経路だけ静かに崩れる。
      // インメモリ実装は JS の文字列キーで null を "" に潰すため**偶然に**冪等であり、
      // この分岐を検査しない限り両実装の食い違いは見えない。
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const observation = await store.createObservation(
        ctx,
        buildNewObservationFixture({ tenantId: "tenant-1" }),
      );
      const input = buildNewMemoryFixture({
        tenantId: "tenant-1",
        sourceObservationId: observation.id,
        extractorVersion: null,
        contentHash: "hash-null-extractor",
      });

      const first = await store.createMemory(ctx, input);
      const second = await store.createMemory(ctx, input);

      expect(second.id).toBe(first.id);
    });

    it("createMemory は sourceObservationId が無い場合、同じ contentHash でも常に新しい Memory を作る（一意制約の対象外）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const input = buildNewMemoryFixture({
        tenantId: "tenant-1",
        sourceObservationId: null,
        extractorVersion: null,
        contentHash: "same-hash-no-source",
        provenance: { kind: "imported", batchId: "batch-1" },
      });

      const first = await store.createMemory(ctx, input);
      const second = await store.createMemory(ctx, input);

      expect(second.id).not.toBe(first.id);
    });

    // -------------------------------------------------------------------
    // recordUsage（D9・docs/architecture.md §3.5「挿入の成否で数える」）
    // -------------------------------------------------------------------

    it("recordUsage は同じ (recallId, memoryId) の再送に対して冪等である（D9）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memory = await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: "tenant-1" }));
      const recallId = await prepareRecallId(ctx);

      const first = await store.recordUsage(ctx, recallId, [memory.id]);
      expect(first.insertedMemoryIds).toEqual([memory.id]);

      const second = await store.recordUsage(ctx, recallId, [memory.id]);
      expect(second.insertedMemoryIds).toEqual([]);
    });

    it("recordUsage は複数 memoryId のうち新規に挿入されたものだけを返す（部分的な再送）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memoryA = await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1" }),
      );
      const memoryB = await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1" }),
      );
      const recallId = await prepareRecallId(ctx);

      const first = await store.recordUsage(ctx, recallId, [memoryA.id]);
      expect(first.insertedMemoryIds).toEqual([memoryA.id]);

      // memoryA は既に記録済み、memoryB は初めて。新規に挿入されたのは memoryB だけ。
      const second = await store.recordUsage(ctx, recallId, [memoryA.id, memoryB.id]);
      expect(second.insertedMemoryIds).toEqual([memoryB.id]);
    });

    it("recordUsage は空配列に対して何も挿入しない", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const recallId = await prepareRecallId(ctx);

      const result = await store.recordUsage(ctx, recallId, []);
      expect(result.insertedMemoryIds).toEqual([]);
    });

    // -------------------------------------------------------------------
    // reinforce（docs/memory-model.md §7、ADR 0010）
    // -------------------------------------------------------------------

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

    it("reinforce は存在しない Memory に対して失敗する", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await expect(store.reinforce(ctx, "does-not-exist", new Date())).rejects.toThrow();
    });

    // -------------------------------------------------------------------
    // updateStatus（docs/memory-model.md §5）
    // -------------------------------------------------------------------

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

    it("updateStatus は opts を省略すると supersededById を変えない", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memory = await store.createMemory(ctx, buildNewMemoryFixture({ tenantId: "tenant-1" }));

      const updated = await store.updateStatus(ctx, memory.id, "archived");

      expect(updated.status).toBe("archived");
      expect(updated.supersededById ?? null).toBe(memory.supersededById ?? null);
    });

    it("updateStatus は存在しない Memory に対して失敗する", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await expect(store.updateStatus(ctx, "does-not-exist", "archived")).rejects.toThrow();
    });

    // -------------------------------------------------------------------
    // countByGroup（docs/recall.md §5 目次帯・第3階）
    // -------------------------------------------------------------------

    it("countByGroup は subject ごとの件数を countKind 付きで返す", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1", subjectId: "user-1" }),
      );
      await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1", subjectId: "user-1" }),
      );
      await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1", subjectId: "user-2" }),
      );

      const groups = await store.countByGroup(ctx, {});
      const byKey = new Map(groups.map((g) => [g.key, g]));

      expect(byKey.get("user-1")?.count).toBe(2);
      expect(byKey.get("user-2")?.count).toBe(1);
      for (const group of groups) {
        expect(["exact", "lower_bound", "unknown"]).toContain(group.countKind);
      }
    });

    it("countByGroup は scope.subjectId で絞り込める", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1", subjectId: "user-1" }),
      );
      await store.createMemory(
        ctx,
        buildNewMemoryFixture({ tenantId: "tenant-1", subjectId: "user-2" }),
      );

      const groups = await store.countByGroup(ctx, { subjectId: "user-1" });
      const total = groups.reduce((sum, g) => sum + g.count, 0);
      expect(total).toBe(1);
    });
  });
}
