import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "../clock.js";

describe("systemClock", () => {
  it("実時間に近い現在時刻を返す", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("fixedClock", () => {
  it("常に同じ固定時刻を返す", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const clock = fixedClock(at);
    expect(clock.now()).toBe(at);
    expect(clock.now().getTime()).toBe(at.getTime());
  });
});
