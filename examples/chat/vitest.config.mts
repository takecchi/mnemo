import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// packages/postgres/vitest.config.mts と同じ理由: dist ではなく各パッケージの src を
// 直接参照する。DB を使うテストがあるためファイル単位は直列にする。
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@mnemo/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@mnemo/openai": fileURLToPath(
        new URL("../../packages/openai/src/index.ts", import.meta.url),
      ),
      "@mnemo/postgres": fileURLToPath(
        new URL("../../packages/postgres/src/index.ts", import.meta.url),
      ),
      "@mnemo/testkit": fileURLToPath(
        new URL("../../packages/testkit/src/index.ts", import.meta.url),
      ),
    },
  },
});
