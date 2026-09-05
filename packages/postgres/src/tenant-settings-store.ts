import { sql } from "drizzle-orm";
import { DEFAULT_HALF_LIFE_HOURS } from "@mnemora/core";
import type { Ctx, TenantSettingsStore } from "@mnemora/core";
import type { Db } from "./client.js";

/**
 * `TenantSettingsStore` の Postgres 実装（roadmap.md 段階3）。
 *
 * `tenant_settings` に行が無いテナントは `DEFAULT_HALF_LIFE_HOURS`（DB 側の
 * `default_half_life_hours DEFAULT 720` と同じ値）を返す。DB の DEFAULT はあくまで
 * 「行が作られたとき」に効くものであり、行そのものが無い場合には効かないため、
 * アプリケーション側でも同じフォールバック値を持つ必要がある。
 */
export class PostgresTenantSettingsStore implements TenantSettingsStore {
  constructor(private readonly db: Db) {}

  async getDefaultHalfLifeHours(ctx: Ctx): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT default_half_life_hours FROM tenant_settings WHERE tenant_id = ${ctx.tenantId} LIMIT 1
    `);
    if (result.rows.length === 0) {
      return DEFAULT_HALF_LIFE_HOURS;
    }
    const row = result.rows[0] as unknown as { default_half_life_hours: number };
    return row.default_half_life_hours;
  }
}
