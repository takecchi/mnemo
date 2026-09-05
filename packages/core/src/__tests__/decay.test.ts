import { describe, expect, it } from "vitest";
import { DEFAULT_DECAY_THRESHOLD, defaultDecayStrategy } from "../strategies/decay.js";

const HOUR = 1000 * 60 * 60;

describe("defaultDecayStrategy.strengthAt", () => {
  it("elapsed=0 のとき strength をそのまま返す", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const value = defaultDecayStrategy.strengthAt(recordedAt, {
      recordedAt,
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 24,
    });
    expect(value).toBeCloseTo(1, 10);
  });

  it("1 half-life 経過で半分になる（recordedAt を起点にする分岐）", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date(recordedAt.getTime() + 24 * HOUR);
    const value = defaultDecayStrategy.strengthAt(now, {
      recordedAt,
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 24,
    });
    expect(value).toBeCloseTo(0.5, 10);
  });

  it("lastReinforcedAt があればそちらを起点にする（recordedAt を起点にしない）", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const lastReinforcedAt = new Date(recordedAt.getTime() + 12 * HOUR);
    const now = new Date(recordedAt.getTime() + 24 * HOUR);
    // recordedAt を起点にすれば elapsed=24h -> 0.5 になるはずだが、
    // lastReinforcedAt(recordedAt+12h) を起点にすると elapsed=12h -> 0.5^(0.5) になる。
    const value = defaultDecayStrategy.strengthAt(now, {
      recordedAt,
      lastReinforcedAt,
      strength: 1,
      halfLifeHours: 24,
    });
    expect(value).toBeCloseTo(Math.pow(0.5, 0.5), 10);
    expect(value).not.toBeCloseTo(0.5, 5);
  });

  it("strength が 1 以外でも比例して掛かる", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date(recordedAt.getTime() + 24 * HOUR);
    const value = defaultDecayStrategy.strengthAt(now, {
      recordedAt,
      lastReinforcedAt: null,
      strength: 2,
      halfLifeHours: 24,
    });
    expect(value).toBeCloseTo(1, 10);
  });
});

describe("defaultDecayStrategy.floorAt", () => {
  it("strength > threshold: base + halfLifeHours * log2(strength/threshold) 時間後を返す", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    // threshold を strength の半分にすると log2(2) = 1 になり、
    // floorAt はちょうど base + halfLifeHours 時間後になる（検算しやすいケース）。
    const floor = defaultDecayStrategy.floorAt(
      { recordedAt, lastReinforcedAt: null, strength: 1, halfLifeHours: 24 },
      0.5,
    );
    expect(floor.getTime()).toBe(recordedAt.getTime() + 24 * HOUR);
  });

  it("strength <= threshold（既に閾値以下）: base をそのまま返す", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const floor = defaultDecayStrategy.floorAt(
      { recordedAt, lastReinforcedAt: null, strength: 0.05, halfLifeHours: 24 },
      0.05,
    );
    expect(floor.getTime()).toBe(recordedAt.getTime());
  });

  it("strength < threshold（既に大きく下回っている）でも base をそのまま返す", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const floor = defaultDecayStrategy.floorAt(
      { recordedAt, lastReinforcedAt: null, strength: 0.01, halfLifeHours: 24 },
      0.05,
    );
    expect(floor.getTime()).toBe(recordedAt.getTime());
  });

  it("threshold を省略すると既定値 DEFAULT_DECAY_THRESHOLD (0.05) が使われる", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const withDefault = defaultDecayStrategy.floorAt({
      recordedAt,
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 24,
    });
    const withExplicit = defaultDecayStrategy.floorAt(
      { recordedAt, lastReinforcedAt: null, strength: 1, halfLifeHours: 24 },
      DEFAULT_DECAY_THRESHOLD,
    );
    expect(withDefault.getTime()).toBe(withExplicit.getTime());
  });

  it("lastReinforcedAt があればそちらを起点にする", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const lastReinforcedAt = new Date(recordedAt.getTime() + 5 * HOUR);
    const floor = defaultDecayStrategy.floorAt(
      { recordedAt, lastReinforcedAt, strength: 1, halfLifeHours: 10 },
      0.5,
    );
    expect(floor.getTime()).toBe(lastReinforcedAt.getTime() + 10 * HOUR);
  });
});

/**
 * ADR 0010 は既定の減衰閾値を 0.05 に固定している。この値は Phase 1 で
 * `decay_floor_at` として実際に書き込まれ、Phase 2 で「いつ検索から外れるか」を決める。
 *
 * 直前の「threshold を省略すると既定値が使われる」テストは、両辺で
 * `DEFAULT_DECAY_THRESHOLD` を使っているため**既定値そのものが変わっても赤くならない**。
 * 既定値を数値で釘付けにするのはこの2本である。
 */
describe("DEFAULT_DECAY_THRESHOLD（ADR 0010 が固定する値）", () => {
  it("既定の閾値は 0.05 である", () => {
    expect(DEFAULT_DECAY_THRESHOLD).toBe(0.05);
  });

  it("threshold 省略時の floorAt が 0.05 由来の絶対時刻になる", () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const floor = defaultDecayStrategy.floorAt({
      recordedAt,
      lastReinforcedAt: null,
      strength: 1,
      halfLifeHours: 24,
    });
    // 24h * log2(1 / 0.05) = 24 * log2(20) ≈ 103.6987 時間後
    const expectedHours = 24 * Math.log2(20);
    // Date はミリ秒未満を切り捨てるので 1ms の許容で比べる
    expect(floor.getTime()).toBeCloseTo(recordedAt.getTime() + expectedHours * HOUR, -1);
  });
});
