import { describe, expect, it } from "vitest";
import type { Ctx, OutboxJobKind, OutboxJobRecord, OutboxStore } from "@mnemo/core";

export interface SeedOutboxJobInput {
  kind: OutboxJobKind;
  payload?: Record<string, unknown>;
  availableAt?: Date;
}

export interface OutboxStoreConformanceOptions {
  name: string;
  createStore: () => OutboxStore | Promise<OutboxStore>;
  /**
   * `OutboxStore` 単体には「積む」操作が無い（`enqueue` は `MemoryStore.createObservationWithOutbox`
   * / `createMemoryWithOutbox` が同一トランザクションで行う、docs/architecture.md §3.4）。
   * この適合テストは `claimBatch`/`complete`/`fail` を単体で検査したいため、adapter に
   * 「生の outbox 行を直接作る」フックを要求する。
   */
  seedJob: (ctx: Ctx, input: SeedOutboxJobInput) => Promise<OutboxJobRecord>;
}

/**
 * `OutboxStore` の適合テスト（roadmap.md 段階3、ADR 0005 の transactional outbox「運搬役」側）。
 *
 * 検査する契約:
 * - `claimBatch` は未処理（completed/failed 双方が null）かつ `availableAt <= now` の
 *   ジョブだけを返す
 * - `claimBatch` は `kinds` で絞り込める
 * - `claimBatch` は `limit` を超えない
 * - `claimBatch` で claim したジョブは、同じ claim 条件で二重に返らない（同時実行の安全）
 * - `complete` / `fail` の後、そのジョブは再び `claimBatch` に現れない
 * - テナント分離: 他テナントの未処理ジョブが `claimBatch` に現れない
 */
export function describeOutboxStoreConformance(options: OutboxStoreConformanceOptions): void {
  const { name, createStore, seedJob } = options;

  describe(`OutboxStore conformance (${name})`, () => {
    it("claimBatch は available_at <= now の未処理ジョブを返す", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await seedJob(ctx, { kind: "extract", payload: { observationId: "obs-1" } });

      const claimed = await store.claimBatch(ctx, {
        limit: 10,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.kind).toBe("extract");
    });

    it("claimBatch は availableAt が未来のジョブを返さない", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const future = new Date(Date.now() + 1000 * 60 * 60);
      await seedJob(ctx, { kind: "extract", availableAt: future });

      const claimed = await store.claimBatch(ctx, {
        limit: 10,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(claimed).toEqual([]);
    });

    it("claimBatch は kinds で絞り込める", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await seedJob(ctx, { kind: "extract" });
      await seedJob(ctx, { kind: "embed" });

      const claimed = await store.claimBatch(ctx, {
        kinds: ["embed"],
        limit: 10,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(claimed.every((job) => job.kind === "embed")).toBe(true);
      expect(claimed.length).toBeGreaterThanOrEqual(1);
    });

    it("claimBatch は limit を超えない件数を返す", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await seedJob(ctx, { kind: "extract" });
      await seedJob(ctx, { kind: "extract" });
      await seedJob(ctx, { kind: "extract" });

      const claimed = await store.claimBatch(ctx, {
        limit: 2,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(claimed.length).toBeLessThanOrEqual(2);
    });

    it("complete したジョブは再び claimBatch に現れない", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const job = await seedJob(ctx, { kind: "extract" });

      const firstClaim = await store.claimBatch(ctx, {
        limit: 10,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(firstClaim.map((j) => j.id)).toContain(job.id);

      await store.complete(ctx, job.id);

      const secondClaim = await store.claimBatch(ctx, {
        limit: 10,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(secondClaim.map((j) => j.id)).not.toContain(job.id);
    });

    it("fail したジョブは再び claimBatch に現れない（Phase 1 は自動リトライしない）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const job = await seedJob(ctx, { kind: "extract" });

      await store.fail(ctx, job.id, "simulated failure");

      const claimed = await store.claimBatch(ctx, {
        limit: 10,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(claimed.map((j) => j.id)).not.toContain(job.id);
    });

    it("complete は存在しないジョブ id に対して例外を投げない（べき等な終端更新）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await expect(store.complete(ctx, "does-not-exist")).resolves.not.toThrow();
    });

    it("fail は存在しないジョブ id に対して例外を投げない（べき等な終端更新）", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      await expect(store.fail(ctx, "does-not-exist", "boom")).resolves.not.toThrow();
    });

    it("クロステナントの claimBatch は他テナントの未処理ジョブを返さない", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };
      await seedJob(ctxA, { kind: "extract" });

      const claimedB = await store.claimBatch(ctxB, {
        limit: 10,
        now: new Date(),
        claimedBy: "worker-1",
      });
      expect(claimedB).toEqual([]);
    });
  });
}
