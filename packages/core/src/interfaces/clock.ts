/**
 * Clock — Phase 1（docs/architecture.md §5.10）。
 *
 * `ScoringStrategy` / `DecayStrategy` は `now` を引数として受け取る純関数であり、
 * `Clock` を直接は使わない。`Clock` は runtime が「現在時刻」を取得する唯一の場所であり、
 * テストで固定時刻を注入できるようにするための境界。
 */
export interface Clock {
  now(): Date;
}
