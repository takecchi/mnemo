import type { RecallResult } from "@mnemora/core";

/**
 * `recall()` の返り値のうち、roadmap.md 段階7の完了条件そのものである
 * `omitted` と `usage` を画面に可視化する（PR 本文「omitted と usage を可視化する」）。
 */
export function formatRecall(result: RecallResult, label: string): string {
  const lines: string[] = [];
  lines.push(`--- recall (${label}) ---`);
  lines.push(`memories: ${result.memories.length} 件返却`);
  for (const m of result.memories) {
    lines.push(`  - [${m.retrievedVia}] score=${m.score.total.toFixed(3)} digest="${m.digest}"`);
  }
  lines.push(`omitted (${result.omitted.length} 件):`);
  if (result.omitted.length === 0) {
    lines.push("  (無し)");
  }
  for (const o of result.omitted) {
    lines.push(`  - ${JSON.stringify(o)}`);
  }
  lines.push(
    `index: totalInScope=${result.index.totalInScope} (countKind=${result.index.countKind}), groups=${result.index.groups.length}`,
  );
  lines.push(
    `usage: chars=${result.usage.chars} estimatedTokens=${result.usage.estimatedTokens} ` +
      `(counter=${result.usage.counter})${
        result.usage.share !== undefined ? ` share=${(result.usage.share * 100).toFixed(1)}%` : ""
      }`,
  );
  return lines.join("\n");
}
