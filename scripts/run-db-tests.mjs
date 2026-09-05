#!/usr/bin/env node
/**
 * ルートの `test` 門の、DB を要求する段。
 *
 * **なぜこの段が要るか**
 *
 * `packages/postgres` と `examples/chat` の検査は本物の Postgres + pgvector を要求する
 * （擬似物へ黙ってフォールバックしない）。そのためスクリプト名は `test` ではなく
 * `test:db` に分けてあり、`pnpm -r --if-present run test` の対象から外れる——
 * **DB を持たない環境でもルートの門が通るように、意図してそうしてある**（PR #3）。
 *
 * その意図は保つ。壊れていたのは別のところで、**「DB テストが通った」と
 * 「DB テストを走らせていない」が、どちらも同じ緑だった**ことである。
 * 落ちたことすら手元では見えなかった。
 *
 * この段はその区別だけを回復する:
 *
 * | 状態 | 終了コード | 出力 |
 * |---|---|---|
 * | `DATABASE_URL` 未設定 | 0 | **「実行していない」と明示する**（緑だが、通ったのとは区別が付く） |
 * | `DATABASE_URL` 設定済み・DB テストが通った | 0 | 実行したことを明示する |
 * | `DATABASE_URL` 設定済み・DB テストが落ちた | **非 0** | pnpm の出力そのまま |
 *
 * `test:db` 自体の意味は変えていない。`DATABASE_URL` 無しで直接呼べば、これまで通り
 * 即エラーになる（`packages/postgres/src/__tests__/test-db.ts` の `requireDatabaseUrl`）。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB_SCRIPT = "test:db";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const BANNER = "─".repeat(72);

/**
 * `test:db` を持つワークスペースパッケージを列挙する。
 *
 * 名前を直書きせず pnpm に問い合わせるのは、**あとから `test:db` を足した
 * パッケージが黙って門から漏れるのを防ぐため**。この段の目的が
 * 「走っていないものが見えること」である以上、一覧そのものがずれてはいけない。
 */
function findDbTestPackages() {
  const listed = spawnSync("pnpm", ["list", "--recursive", "--depth", "-1", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (listed.status !== 0) {
    throw new Error(
      `ワークスペースの一覧取得に失敗しました (pnpm list, exit ${listed.status}):\n${listed.stderr ?? ""}`,
    );
  }
  /** @type {{ name: string; path: string }[]} */
  const projects = JSON.parse(listed.stdout);
  return projects
    .filter((project) => project.path !== repoRoot.replace(/\/$/, ""))
    .filter((project) => {
      try {
        const manifest = JSON.parse(readFileSync(`${project.path}/package.json`, "utf8"));
        return Boolean(manifest.scripts?.[DB_SCRIPT]);
      } catch {
        return false;
      }
    })
    .map((project) => project.name)
    .sort();
}

const packages = findDbTestPackages();

if (packages.length === 0) {
  // `test:db` を持つパッケージが1つも無い。黙って通す（隠すものが無い）。
  process.exit(0);
}

const listing = packages.map((name) => `    - ${name} (${DB_SCRIPT})`).join("\n");

if (!process.env.DATABASE_URL) {
  console.log(
    [
      "",
      BANNER,
      "⚠ DB テストは実行していません（DATABASE_URL が未設定）",
      "",
      "  実行しなかったもの:",
      listing,
      "",
      "  この門が緑であることは、DB 側を見たことになりません。",
      "  DB 側も通すには、本物の Postgres + pgvector を指してから同じ門を実行すること:",
      "",
      "    DATABASE_URL=postgresql://... pnpm run test",
      "",
      BANNER,
      "",
    ].join("\n"),
  );
  process.exit(0);
}

console.log(
  [
    "",
    BANNER,
    "DATABASE_URL が設定されているため、DB テストを実行します",
    "",
    "  対象:",
    listing,
    "",
    BANNER,
    "",
  ].join("\n"),
);

const run = spawnSync("pnpm", ["--recursive", "--if-present", "run", DB_SCRIPT], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (run.status !== 0) {
  console.log(["", BANNER, "✗ DB テストが落ちました。", BANNER, ""].join("\n"));
  process.exit(run.status === null ? 1 : run.status);
}

console.log(["", BANNER, "✔ DB テストも実行し、通りました。", BANNER, ""].join("\n"));
