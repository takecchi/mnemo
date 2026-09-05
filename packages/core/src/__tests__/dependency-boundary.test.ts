import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/architecture.md §3.6: 「core が実行時に依存してよいのは zod だけである」
 * 「これは方針ではなく機械的に担保する」——このテストがその機械的な担保にあたる。
 *
 * node script でもよいと指示されているが、CI の `test` ステップで必ず走らせるため
 * vitest のテストとして書く。パッケージは CommonJS 出力のため `import.meta.url` ではなく
 * `__dirname` を使う。
 */
const packageJsonPath = join(__dirname, "../../package.json");

function readPackageJson(): { dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(packageJsonPath, "utf-8"));
}

describe("packages/core の依存境界（docs/architecture.md §3.6）", () => {
  it("dependencies のキーは ['zod'] のみである", () => {
    const pkg = readPackageJson();
    const keys = Object.keys(pkg.dependencies ?? {});
    expect(keys).toEqual(["zod"]);
  });
});
