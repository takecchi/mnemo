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

/**
 * docs/memory-model.md §3「三つの時計」の中心的な要求:
 * **鮮度は `occurred_at ?? recorded_at` を使い、減衰は `last_reinforced_at` を使う。**
 * この2つを混ぜると「昔起きたが最近よく使う記憶」と「最近起きたが一度も使われていない記憶」を
 * 区別できなくなる——文書が名指しで禁じている取り違えである。
 *
 * 下の2本は、その混同が起きたときに実際に赤くなるための歯である。
 * 3つの時刻をすべて異なる値にしないと、混同しても値が一致してしまい検出できない。
 */
describe("defaultScoringStrategy: 鮮度と減衰は別の時計を使う（docs/memory-model.md §3）", () => {
  const occurredAt = new Date("2026-01-01T00:00:00.000Z");
  const recordedAt = new Date("2026-01-02T00:00:00.000Z"); // occurredAt + 24h
  const lastReinforcedAt = new Date("2026-01-04T00:00:00.000Z"); // occurredAt + 72h
  const now = new Date("2026-01-05T00:00:00.000Z"); // occurredAt + 96h

  const input = {
    now,
    tags: [],
    queryTags: [],
    occurredAt,
    recordedAt,
    lastReinforcedAt,
    strength: 1,
    halfLifeHours: 24,
  };

  it("freshness は occurredAt を起点にする（lastReinforcedAt にも recordedAt にも寄らない）", () => {
    const score = defaultScoringStrategy(input);
    // occurredAt 起点なら elapsed=96h = 4 half-life -> 0.0625
    expect(score.freshness).toBeCloseTo(Math.pow(0.5, 4), 10);
    // lastReinforcedAt 起点(elapsed=24h -> 0.5) でも recordedAt 起点(elapsed=72h -> 0.125) でもない
    expect(score.freshness).not.toBeCloseTo(0.5, 5);
    expect(score.freshness).not.toBeCloseTo(0.125, 5);
  });

  it("decay は lastReinforcedAt を起点にする（occurredAt にも寄らない）", () => {
    const score = defaultScoringStrategy(input);
    // lastReinforcedAt 起点なら elapsed=24h = 1 half-life -> 0.5
    expect(score.decay).toBeCloseTo(0.5, 10);
    // occurredAt 起点(0.0625) でも recordedAt 起点(0.125) でもない
    expect(score.decay).not.toBeCloseTo(Math.pow(0.5, 4), 5);
    expect(score.decay).not.toBeCloseTo(0.125, 5);
  });
});
