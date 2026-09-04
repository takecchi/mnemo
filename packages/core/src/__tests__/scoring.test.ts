import { describe, expect, it } from "vitest";
import { defaultScoringStrategy } from "../strategies/scoring.js";

const HOUR = 1000 * 60 * 60;

function baseInput() {
  const recordedAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    now: recordedAt,
    tags: ["a", "b"],
    queryTags: [] as string[],
    occurredAt: null,
    recordedAt,
    lastReinforcedAt: null,
    strength: 1,
    halfLifeHours: 24,
  };
}

describe("defaultScoringStrategy", () => {
  it("similarity が無い場合は score.similarity が undefined で total に中立の 1 として掛かる", () => {
    const score = defaultScoringStrategy(baseInput());
    expect(score.similarity).toBeUndefined();
    // decay=1, tagMatch=1(queryTags空), freshness=1, strength=1 のとき total=1
    expect(score.total).toBeCloseTo(1, 10);
  });

  it("similarity がある場合は score.similarity に反映され total にも掛かる", () => {
    const score = defaultScoringStrategy({ ...baseInput(), similarity: 0.5 });
    expect(score.similarity).toBe(0.5);
    expect(score.total).toBeCloseTo(0.5, 10);
  });

  it("queryTags が空のとき tagMatch は中立の 1", () => {
    const score = defaultScoringStrategy({ ...baseInput(), queryTags: [] });
    expect(score.tagMatch).toBe(1);
  });

  it("queryTags があり一致が無いとき tagMatch は 1 のまま（除外条件にしない）", () => {
    const score = defaultScoringStrategy({ ...baseInput(), tags: ["x"], queryTags: ["y", "z"] });
    expect(score.tagMatch).toBe(1);
  });

  it("queryTags と一致があるとき tagMatch は 1 より大きくなる", () => {
    const score = defaultScoringStrategy({
      ...baseInput(),
      tags: ["a", "b"],
      queryTags: ["a", "z"],
    });
    expect(score.tagMatch).toBeCloseTo(1.1, 10);
  });

  it("時間が経つほど decay は小さくなる（lastReinforcedAt 基準）", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const lastReinforcedAt = new Date(recordedAt.getTime() - 100 * HOUR);
    const now = new Date(recordedAt.getTime() + 24 * HOUR);
    const score = defaultScoringStrategy({
      now,
      tags: [],
      queryTags: [],
      occurredAt: null,
      recordedAt,
      lastReinforcedAt,
      strength: 1,
      halfLifeHours: 24,
    });
    expect(score.decay).toBeLessThan(1);
  });

  it("freshness は occurredAt を優先し、古い occurredAt ほど低くなる", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const occurredAt = new Date(recordedAt.getTime() - 24 * HOUR);
    const score = defaultScoringStrategy({
      now: recordedAt,
      tags: [],
      queryTags: [],
      occurredAt,
      recordedAt,
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 24,
    });
    expect(score.freshness).toBeCloseTo(0.5, 10);
  });

  it("occurredAt が無ければ recordedAt を鮮度の起点にする", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const score = defaultScoringStrategy({
      now: recordedAt,
      tags: [],
      queryTags: [],
      occurredAt: null,
      recordedAt,
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 24,
    });
    expect(score.freshness).toBeCloseTo(1, 10);
  });

  it("strength は score.strength にそのまま反映され total にも掛かる", () => {
    const score = defaultScoringStrategy({ ...baseInput(), strength: 0.5 });
    expect(score.strength).toBe(0.5);
    expect(score.total).toBeCloseTo(0.5, 10);
  });
});
