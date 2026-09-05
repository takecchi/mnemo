import { describe, expect, it, vi } from "vitest";
import { InlineScheduler } from "../inline-scheduler.js";
import type { OutboxJob } from "../interfaces/scheduler.js";

const ctx = { tenantId: "tenant-1" };
const job: OutboxJob = { id: "job-1", tenantId: "tenant-1", kind: "extract", payload: {} };

describe("InlineScheduler", () => {
  it("handler を同期的（呼び出しコンテキストの中）に実行し、成功時は解決する", async () => {
    const handler = vi.fn(async () => {});
    const scheduler = new InlineScheduler(handler);

    await scheduler.enqueue(ctx, job);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ctx, job);
  });

  it("handler が失敗したら enqueue も失敗する（キューに逃さず、失敗を隠さない）", async () => {
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const scheduler = new InlineScheduler(handler);

    await expect(scheduler.enqueue(ctx, job)).rejects.toThrow("boom");
  });
});
