import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// テストは @mnemora/core の dist（build 前は存在しない）ではなく src を直接参照する。
// CI は typecheck → lint → test → build の順で走るため、test 実行時点では
// core の dist が無いことを前提にする（packages/testkit/tsconfig.json の
// paths 設定と同じ理由・同じ狙い）。
export default defineConfig({
  resolve: {
    alias: {
      "@mnemora/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
