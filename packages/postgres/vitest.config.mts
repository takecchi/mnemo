import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// packages/testkit/vitest.config.mts と同じ理由: dist ではなく core/src を直接参照する。
export default defineConfig({
  test: {
    // DB を使うテストは本質的に直列に走らせたほうが安全（同一 DB を使い回すテストがある場合の
    // 競合を避ける）。各テストファイルは自分専用のスキーマ/テーブル接頭辞を使うため、
    // 通常は並列でも安全だが、CI のサービスコンテナの資源制約を考慮してファイル単位は直列にする。
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@mnemo/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@mnemo/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)),
    },
  },
});
