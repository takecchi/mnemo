import { sql } from "drizzle-orm";
import type { ClaimOutboxJobsOptions, Ctx, OutboxJobRecord, OutboxStore } from "@mnemo/core";
import type { Db } from "./client.js";
import { isUuidLike, rowToOutboxJob, type OutboxJobRow } from "./mapping.js";

/**
 * `OutboxStore` の Postgres 実装（roadmap.md 段階3、ADR 0005 の transactional outbox
 * 「運搬役」側）。
 *
 * `claimBatch` は `FOR UPDATE SKIP LOCKED` を使う。複数のワーカーが同時に `tick()` を
 * 呼んでも、同じ行を二重に claim しない（ロック待ちで詰まらせるのでもなく、既に他の
 * ワーカーが取ろうとしている行はスキップして次の行を取りに行く）。
 */
export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly db: Db) {}

  async claimBatch(ctx: Ctx, opts: ClaimOutboxJobsOptions): Promise<OutboxJobRecord[]> {
    const kindsFilter =
      opts.kinds !== undefined ? sql`AND kind = ANY(${sql.param(opts.kinds)}::text[])` : sql``;

    const result = await this.db.execute(sql`
      WITH claimable AS (
        SELECT id FROM outbox
        WHERE tenant_id = ${ctx.tenantId}
          AND completed_at IS NULL
          AND failed_at IS NULL
          AND available_at <= ${opts.now}
          ${kindsFilter}
        ORDER BY available_at ASC
        LIMIT ${opts.limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox o
      SET claimed_at = ${opts.now}, claimed_by = ${opts.claimedBy}, attempts = attempts + 1
      FROM claimable c
      WHERE o.id = c.id
      RETURNING o.*
    `);
    return result.rows.map((row) => rowToOutboxJob(row as unknown as OutboxJobRow));
  }

  async complete(ctx: Ctx, jobId: string): Promise<void> {
    // id 列は uuid 型。べき等な終端更新（存在しない/形式が不正な id でも例外を投げない）
    // という契約のため、UUID の形をしていない入力はここで静かに無視する
    // （実 DB 検査で判明: 素通しすると invalid input syntax for type uuid で例外になる）。
    if (!isUuidLike(jobId)) {
      return;
    }
    await this.db.execute(sql`
      UPDATE outbox
      SET completed_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${jobId}
    `);
  }

  async fail(ctx: Ctx, jobId: string, error: string): Promise<void> {
    if (!isUuidLike(jobId)) {
      return;
    }
    await this.db.execute(sql`
      UPDATE outbox
      SET failed_at = now(), last_error = ${error}
      WHERE tenant_id = ${ctx.tenantId} AND id = ${jobId}
    `);
  }
}
