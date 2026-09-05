import type { Ctx } from "../ctx.js";

/**
 * `tenant_settings.default_half_life_hours` の DB 側デフォルト（720時間 = 30日、
 * docs/memory-model.md §10 の DDL `DEFAULT 720`）と一致させる、テナント設定行が
 * 存在しない場合のフォールバック値。adapter 実装（`packages/postgres`）・
 * `packages/testkit` の in-memory 実装の両方がこの定数を使う。
 */
export const DEFAULT_HALF_LIFE_HOURS = 720;

/**
 * TenantSettingsStore — Phase 1（本 PR で追加）。
 *
 * `docs/memory-model.md` §10 の `tenant_settings` テーブルのうち、取り込み
 * （roadmap.md 段階3）が必要とする「Memory 作成時の既定 half-life」の読み出しだけを
 * 切り出した最小限の interface。テナント設定の完全な CRUD（`event_retention_days`・
 * `taxonomy_mode` の読み書き等）は本 PR の範囲外であり、必要になった段階で
 * このインターフェースを拡張する。
 *
 * 契約:
 * - テナントに `tenant_settings` 行が無い場合は `DEFAULT_HALF_LIFE_HOURS` を返す
 *   （エラーにしない。既定値が無いテナントは「まだ設定していない」という正常系）。
 */
export interface TenantSettingsStore {
  getDefaultHalfLifeHours(ctx: Ctx): Promise<number>;
}
