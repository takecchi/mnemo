import type { ClaimOutboxJobsOptions, Ctx, OutboxJobRecord, OutboxStore } from "@mnemo/core";

/**
 * `OutboxStore` のインメモリ・プレースホルダ実装（roadmap.md 段階3）。
 *
 * `jobs` 配列は呼び出し側から共有参照として渡される想定
 * （`InMemoryMemoryStore.outboxJobs` と同じ配列を渡すことで、`createObservationWithOutbox` /
 * `createMemoryWithOutbox` が積んだジョブをここから claim/complete/fail できる）。
 */
export class InMemoryOutboxStore implements OutboxStore {
  constructor(private readonly jobs: OutboxJobRecord[]) {}

  async claimBatch(ctx: Ctx, opts: ClaimOutboxJobsOptions): Promise<OutboxJobRecord[]> {
    const eligible = this.jobs.filter(
      (job) =>
        job.tenantId === ctx.tenantId &&
        (opts.kinds === undefined || opts.kinds.includes(job.kind)) &&
        (job.completedAt ?? null) === null &&
        (job.failedAt ?? null) === null &&
        job.availableAt <= opts.now,
    );
    eligible.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime());
    const claimed = eligible.slice(0, opts.limit);
    for (const job of claimed) {
      job.claimedAt = opts.now;
      job.claimedBy = opts.claimedBy;
      job.attempts += 1;
    }
    return claimed.map((job) => ({ ...job }));
  }

  async complete(ctx: Ctx, jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId && j.tenantId === ctx.tenantId);
    if (job) {
      job.completedAt = new Date();
    }
  }

  async fail(ctx: Ctx, jobId: string, error: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId && j.tenantId === ctx.tenantId);
    if (job) {
      job.failedAt = new Date();
      job.lastError = error;
    }
  }
}
