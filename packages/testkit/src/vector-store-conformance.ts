import { describe, expect, it } from "vitest";
import type { Ctx, EmbeddingSpaceId, VectorStore } from "@mnemo/core";

export interface VectorStoreConformanceOptions {
  name: string;
  createStore: () => VectorStore | Promise<VectorStore>;
}

const space: EmbeddingSpaceId = { provider: "test", model: "fixture-model", dimensions: 3 };

/**
 * `VectorStore` の適合テスト（docs/architecture.md §5.2）。
 *
 * Phase 1 の段階1では、実際の pgvector・`EXPLAIN` 検査（段階2の完了条件）はまだ扱わない。
 * ここで検査するのは、`VectorStore` の基本契約——upsert/search/delete の往復と、
 * テナント分離——が実際に実行できることである。
 */
export function describeVectorStoreConformance(options: VectorStoreConformanceOptions): void {
  const { name, createStore } = options;

  describe(`VectorStore conformance (${name})`, () => {
    it("upsert した vector が search で見つかる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };

      await store.upsert(ctx, space, "mem-1", [1, 0, 0]);

      const hits = await store.search(ctx, space, [1, 0, 0], {
        limit: 10,
        filter: { tenantId: "tenant-1" },
      });

      expect(hits.map((hit) => hit.memoryId)).toContain("mem-1");
    });

    it("クロステナントの search には他テナントの vector が現れない", async () => {
      const store = await createStore();
      const ctxA: Ctx = { tenantId: "tenant-a" };
      const ctxB: Ctx = { tenantId: "tenant-b" };

      await store.upsert(ctxA, space, "mem-a", [1, 0, 0]);

      const hitsB = await store.search(ctxB, space, [1, 0, 0], {
        limit: 10,
        filter: { tenantId: "tenant-b" },
      });

      expect(hitsB).toEqual([]);
    });

    it("delete した vector は search に現れなくなる", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };

      await store.upsert(ctx, space, "mem-1", [1, 0, 0]);
      await store.delete(ctx, space, "mem-1");

      const hits = await store.search(ctx, space, [1, 0, 0], {
        limit: 10,
        filter: { tenantId: "tenant-1" },
      });

      expect(hits.map((hit) => hit.memoryId)).not.toContain("mem-1");
    });

    it("search は limit を超えない件数を返す", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: "tenant-1" };

      await store.upsert(ctx, space, "mem-1", [1, 0, 0]);
      await store.upsert(ctx, space, "mem-2", [0, 1, 0]);
      await store.upsert(ctx, space, "mem-3", [0, 0, 1]);

      const hits = await store.search(ctx, space, [1, 0, 0], {
        limit: 2,
        filter: { tenantId: "tenant-1" },
      });

      expect(hits.length).toBeLessThanOrEqual(2);
    });
  });
}
