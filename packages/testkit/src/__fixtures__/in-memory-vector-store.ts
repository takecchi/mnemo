import type {
  Ctx,
  EmbeddingSpaceId,
  MemoryId,
  VectorFilter,
  VectorHit,
  VectorStore,
} from "@mnemora/core";

interface Entry {
  tenantId: string;
  memoryId: MemoryId;
  vector: number[];
}

function euclideanDistance(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  let sumOfSquares = 0;
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sumOfSquares += diff * diff;
  }
  return Math.sqrt(sumOfSquares);
}

/**
 * `VectorStore` のインメモリ・プレースホルダ実装。索引・pgvector を模さない
 * 最小実装であり、`packages/testkit` の適合テストを実行できることを示すためだけのもの。
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly entries = new Map<string, Entry>();

  private key(space: EmbeddingSpaceId, tenantId: string, memoryId: MemoryId): string {
    return `${space.provider}:${space.model}:${space.dimensions}:${tenantId}:${memoryId}`;
  }

  async upsert(
    ctx: Ctx,
    space: EmbeddingSpaceId,
    memoryId: MemoryId,
    vector: number[],
  ): Promise<void> {
    this.entries.set(this.key(space, ctx.tenantId, memoryId), {
      tenantId: ctx.tenantId,
      memoryId,
      vector,
    });
  }

  async search(
    _ctx: Ctx,
    space: EmbeddingSpaceId,
    query: number[],
    opts: { limit: number; filter: VectorFilter },
  ): Promise<VectorHit[]> {
    // 索引を模す prefix は space（provider/model/dimensions）だけで絞る。
    // テナント分離は `opts.filter.tenantId` の一致だけで行う——これが
    // `VectorStore.search` の実際の契約（docs/architecture.md §5.2: filter は
    // 索引で表現できる形に限る）であり、ctx.tenantId で二重に絞ってしまうと
    // 「filter.tenantId を無視しても壊れない」という誤ったプレースホルダになる。
    const prefix = `${space.provider}:${space.model}:${space.dimensions}:`;
    const hits: VectorHit[] = [];
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      if (entry.tenantId !== opts.filter.tenantId) {
        continue;
      }
      hits.push({ memoryId: entry.memoryId, distance: euclideanDistance(query, entry.vector) });
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits.slice(0, opts.limit);
  }

  async delete(ctx: Ctx, space: EmbeddingSpaceId, memoryId: MemoryId): Promise<void> {
    this.entries.delete(this.key(space, ctx.tenantId, memoryId));
  }
}
