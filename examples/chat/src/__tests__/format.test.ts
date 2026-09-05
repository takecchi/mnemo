import { describe, expect, it } from "vitest";
import type { RecallResult } from "@mnemora/core";
import { formatRecall } from "../format.js";

function baseResult(overrides: Partial<RecallResult> = {}): RecallResult {
  return {
    recallId: "recall-1",
    memories: [],
    omitted: [],
    index: { groups: [], totalInScope: 0, countKind: "exact" },
    usage: {
      chars: 0,
      estimatedTokens: 0,
      counter: "heuristic",
      byTier: { full: 0, digest: 0, index: 0 },
      indexChars: 0,
    },
    explain: { stages: [] },
    ...overrides,
  };
}

describe("formatRecall", () => {
  it("omitted が空、share 無しの場合は「(無し)」と share 抜きの usage 行を出す", () => {
    const output = formatRecall(baseResult(), "test");
    expect(output).toContain("(無し)");
    expect(output).not.toContain("share=");
  });

  it("omitted が非空、share ありの場合はその内容と share を出す", () => {
    const result = baseResult({
      omitted: [{ kind: "budget_dropped", count: 3, countKind: "exact" }],
      usage: {
        chars: 50,
        estimatedTokens: 13,
        counter: "heuristic",
        byTier: { full: 0, digest: 50, index: 0 },
        indexChars: 0,
        share: 0.5,
      },
    });
    const output = formatRecall(result, "test");
    expect(output).not.toContain("(無し)");
    expect(output).toContain("budget_dropped");
    expect(output).toContain("share=50.0%");
  });
});
