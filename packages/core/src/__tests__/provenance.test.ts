import { describe, expect, it } from "vitest";
import { ProvenanceSchema } from "../provenance.js";

describe("ProvenanceSchema", () => {
  it("accepts kind: 'stated'", () => {
    const result = ProvenanceSchema.safeParse({
      kind: "stated",
      sourceObservationId: "obs-1",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects kind: 'stated' が sourceObservationId を欠く場合", () => {
    const result = ProvenanceSchema.safeParse({
      kind: "stated",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts kind: 'inferred'", () => {
    const result = ProvenanceSchema.safeParse({
      kind: "inferred",
      model: "gpt-x",
      promptVersion: "v1",
      basis: { memoryIds: ["m1"], observationIds: [] },
      confidence: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it("rejects kind: 'inferred' の confidence が範囲外", () => {
    const result = ProvenanceSchema.safeParse({
      kind: "inferred",
      model: "gpt-x",
      promptVersion: "v1",
      basis: { memoryIds: [], observationIds: [] },
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts kind: 'consolidated'", () => {
    const result = ProvenanceSchema.safeParse({
      kind: "consolidated",
      sources: ["m1", "m2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects kind: 'consolidated' の sources が空配列", () => {
    const result = ProvenanceSchema.safeParse({
      kind: "consolidated",
      sources: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts kind: 'reflected'（sources 省略可）", () => {
    const result = ProvenanceSchema.safeParse({ kind: "reflected" });
    expect(result.success).toBe(true);
  });

  it("accepts kind: 'reflected'（sources 指定あり）", () => {
    const result = ProvenanceSchema.safeParse({ kind: "reflected", sources: ["m1"] });
    expect(result.success).toBe(true);
  });

  it("accepts kind: 'imported'", () => {
    const result = ProvenanceSchema.safeParse({ kind: "imported", batchId: "batch-1" });
    expect(result.success).toBe(true);
  });

  it("rejects kind: 'imported' が batchId を欠く場合", () => {
    const result = ProvenanceSchema.safeParse({ kind: "imported" });
    expect(result.success).toBe(false);
  });

  it("rejects 未知の kind", () => {
    const result = ProvenanceSchema.safeParse({ kind: "unknown_kind" });
    expect(result.success).toBe(false);
  });
});
