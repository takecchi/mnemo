import { DEFAULT_HALF_LIFE_HOURS } from "@mnemora/core";
import type { Ctx, TenantSettingsStore } from "@mnemora/core";

/**
 * `TenantSettingsStore` のインメモリ・プレースホルダ実装（roadmap.md 段階3）。
 * 行が無いテナントは `DEFAULT_HALF_LIFE_HOURS` を返す（本物の DB の
 * `default_half_life_hours DEFAULT 720` と対応する契約）。
 */
export class InMemoryTenantSettingsStore implements TenantSettingsStore {
  private readonly overrides = new Map<string, number>();

  setDefaultHalfLifeHours(tenantId: string, hours: number): void {
    this.overrides.set(tenantId, hours);
  }

  async getDefaultHalfLifeHours(ctx: Ctx): Promise<number> {
    return this.overrides.get(ctx.tenantId) ?? DEFAULT_HALF_LIFE_HOURS;
  }
}
