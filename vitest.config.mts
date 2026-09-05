import { defineConfig } from "vitest/config";

/**
 * ルート直下の検査だけを対象にする（`scripts/` の門そのものを測る歯）。
 * 各パッケージの検査は、それぞれの `vitest.config.mts` が持つ。
 *
 * 歯は子プロセスとして本物の門を起動する（擬似の実行器に差し替えない）ため、
 * 通常のユニットテストより時間がかかる。既定のタイムアウトでは足りない。
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
