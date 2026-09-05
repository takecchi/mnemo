import { createHash } from "node:crypto";

/**
 * `contentHash`（SHA-256 hex, マネージャー決定 D16）の実装。
 *
 * `packages/core` はこの計算を行わない（`node:crypto` は core の「zod のみ」という
 * 実行時依存の制約に反するため、docs/architecture.md §3.6）。`runtime.ts` の
 * `RuntimeDeps.hashContent` として、adapter 側のこの実装を注入する。
 */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
