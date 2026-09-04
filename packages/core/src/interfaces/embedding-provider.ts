import type { Ctx } from "../ctx.js";
import type { EmbeddingSpaceId } from "../embedding.js";

/**
 * EmbeddingProvider — Phase 1（docs/architecture.md §5.5）。
 *
 * 契約:
 * - 1つのインスタンスは1つの `EmbeddingSpaceId` に固定される。次元をモデルに応じて
 *   動的に変える実装は許容しない。
 * - `packages/anthropic` はこの interface を実装しない（Anthropic は埋め込み API を
 *   提供していないため）。
 */
export interface EmbeddingProvider {
  readonly space: EmbeddingSpaceId;
  embed(ctx: Ctx, texts: string[]): Promise<number[][]>;
}
