import { describe, expect, it } from "vitest";
import type { Ctx, EmbeddingSpaceId, MemoryId, VectorStore } from "@mnemora/core";

export interface VectorStoreConformanceOptions {
  name: string;
  createStore: () => VectorStore | Promise<VectorStore>;
  /**
   * `packages/postgres` の `memory_embeddings_<space>` テーブルは `memory_id` を
   * `memories(id)` への外部キーにしている（docs/memory-model.md §10）。この適合テストは
   * `VectorStore` 単体を検査するが、外部キーを持つ adapter のために「実在の Memory の id を
   * 用意する」フックを持つ。省略時は固定文字列を使う（外部キーを持たない in-memory 実装向け）。
   */
  prepareMemoryId?: (ctx: Ctx) => Promise<MemoryId> | MemoryId;
}

const space: EmbeddingSpaceId = { provider: "test", model: "fixture-model", dimensions: 3 };

/**
 * `VectorStore` の適合テスト（docs/architecture.md §5.2）。
 *
 * ここで検査するのは `VectorStore` の基本契約——upsert/search/delete の往復、
 * テナント分離、limit の遵守——である。`EXPLAIN` で HNSW 索引が使われることの検査
 * （roadmap.md 段階2の完了条件）は pgvector 固有の関心事であり、`packages/postgres` 側の
 * テスト（生 SQL・`EXPLAIN` を直接扱う）に置く。
 */
export function describeVectorStoreConformance(options: VectorStoreConformanceOptions): void {
  const { name, createStore } = options;
  let fixtureMemoryIdCounter = 0;
  const prepareMemoryId: (ctx: Ctx) => Promise<MemoryId> | MemoryId =
    options.prepareMemoryId ?? (() => `mem-fixture-${(fixtureMemoryIdCounter += 1)}`);

  describe(`VectorStore conformance (${name})`, () => {
    it("upsert した vector が search で見つかる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memoryId = await prepareMemoryId(ctx);

      await store.upsert(ctx, space, memoryId, [1, 0, 0]);

      const hits = await store.search(ctx, space, [1, 0, 0], {
        limit: 10,
        filter: { tenantId: "tenant-1" },
      });

      expect(hits.map((hit) => hit.memoryId)).toContain(memoryId);
    });

    it("同じ memoryId に対する2度目の upsert は行を増やさず、ベクトルを更新する", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memoryId = await prepareMemoryId(ctx);

      await store.upsert(ctx, space, memoryId, [1, 0, 0]);
      await store.upsert(ctx, space, memoryId, [0, 1, 0]);

      const hits = await store.search(ctx, space, [0, 1, 0], {
        limit: 10,
        filter: { tenantId: "tenant-1" },
      });
      const matches = hits.filter((hit) => hit.memoryId === memoryId);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.distance).toBeCloseTo(0, 5);
    });

    it("クロステナントの search には他テナントの vector が現れない", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };
      const memoryId = await prepareMemoryId(ctxA);

      await store.upsert(ctxA, space, memoryId, [1, 0, 0]);

      const hitsB = await store.search(ctxB, space, [1, 0, 0], {
        limit: 10,
        filter: { tenantId: "tenant-b" },
      });

      expect(hitsB).toEqual([]);
    });

    it("delete した vector は search に現れなくなる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memoryId = await prepareMemoryId(ctx);

      await store.upsert(ctx, space, memoryId, [1, 0, 0]);
      await store.delete(ctx, space, memoryId);

      const hits = await store.search(ctx, space, [1, 0, 0], {
        limit: 10,
        filter: { tenantId: "tenant-1" },
      });

      expect(hits.map((hit) => hit.memoryId)).not.toContain(memoryId);
    });

    it("search は limit を超えない件数を返す", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };
      const memoryId1 = await prepareMemoryId(ctx);
      const memoryId2 = await prepareMemoryId(ctx);
      const memoryId3 = await prepareMemoryId(ctx);

      await store.upsert(ctx, space, memoryId1, [1, 0, 0]);
      await store.upsert(ctx, space, memoryId2, [0, 1, 0]);
      await store.upsert(ctx, space, memoryId3, [0, 0, 1]);

      const hits = await store.search(ctx, space, [1, 0, 0], {
        limit: 2,
        filter: { tenantId: "tenant-1" },
      });

      expect(hits.length).toBeLessThanOrEqual(2);
    });
  });
}
