import { z } from "zod";

/**
 * 埋め込み空間の識別子（docs/architecture.md §5.2、D8）。
 *
 * D8: `provider` を足す。`docs/architecture.md` §5.2 は当初 `{ model, dimensions }` のみと
 * していたが、`docs/memory-model.md` はテーブル名スラグを `(provider, model, dimensions)` から
 * 導出すると書いており、2つの doc が食い違っていた。本 PR で `architecture.md` 側を
 * `{ provider, model, dimensions }` に修正し、この型に合わせた（このコミットで docs も修正済み）。
 */
export interface EmbeddingSpaceId {
  provider: string;
  model: string;
  dimensions: number;
}

export const EmbeddingSpaceIdSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
}) satisfies z.ZodType<EmbeddingSpaceId>;
