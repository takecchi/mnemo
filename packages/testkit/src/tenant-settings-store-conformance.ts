import { describe, expect, it } from "vitest";
import { DEFAULT_HALF_LIFE_HOURS } from "@mnemo/core";
import type { Ctx, TenantSettingsStore } from "@mnemo/core";

export interface TenantSettingsStoreConformanceOptions {
  name: string;
  createStore: () => TenantSettingsStore | Promise<TenantSettingsStore>;
  /**
   * テナントの `default_half_life_hours` を明示的に設定するためのフック。
   * 省略時はこのケースをスキップする（in-memory 実装は簡易な setter を持つ想定だが、
   * 将来 setter を持たない読み取り専用 adapter が来た場合にも壊れないようにする）。
   */
  setDefaultHalfLifeHours?: (ctx: Ctx, hours: number) => Promise<void> | void;
}

/**
 * `TenantSettingsStore` の適合テスト（roadmap.md 段階3、`decayFloorAt` 計算に使う
 * テナント既定値の読み出し契約）。
 */
export function describeTenantSettingsStoreConformance(
  options: TenantSettingsStoreConformanceOptions,
): void {
  const { name, createStore, setDefaultHalfLifeHours } = options;

  describe(`TenantSettingsStore conformance (${name})`, () => {
    it("設定行が無いテナントには DEFAULT_HALF_LIFE_HOURS を返す", async () => {
      const store = await createStore();
      const ctx: Ctx = { tenantId: `tenant-unset-${Math.random()}` };
      expect(await store.getDefaultHalfLifeHours(ctx)).toBe(DEFAULT_HALF_LIFE_HOURS);
    });

    if (setDefaultHalfLifeHours) {
      it("設定済みのテナントにはその値を返す", async () => {
        const store = await createStore();
        const ctx: Ctx = { tenantId: `tenant-custom-${Math.random()}` };
        await setDefaultHalfLifeHours(ctx, 24);
        expect(await store.getDefaultHalfLifeHours(ctx)).toBe(24);
      });
    }
  });
}
