/**
 * DecayStrategy — Phase 1・純関数（docs/architecture.md §5.7、ADR 0010）。
 *
 * 両方とも純関数であり、状態を保存しない。`strengthAt` の結果はどこにも永続化されない。
 * 永続化されるのは書き込み時に一度だけ計算する `decay_floor_at`（`floorAt` の戻り値）。
 */
export interface DecayParams {
  /** Memory.recordedAt。lastReinforcedAt が無い場合の起点として使う。 */
  recordedAt: Date;
  /** Memory.lastReinforcedAt。無ければ recordedAt を起点にする（ADR 0010）。 */
  lastReinforcedAt?: Date | null;
  strength: number;
  halfLifeHours: number;
}

export interface DecayStrategy {
  strengthAt(now: Date, params: DecayParams): number;
  /** threshold を省略すると `DEFAULT_DECAY_THRESHOLD`（0.05、ADR 0010）が使われる。 */
  floorAt(params: DecayParams, threshold?: number): Date;
}

/** ADR 0010 が固定する既定の減衰閾値。 */
export const DEFAULT_DECAY_THRESHOLD = 0.05;

const MS_PER_HOUR = 1000 * 60 * 60;

function decayBase(params: DecayParams): Date {
  return params.lastReinforcedAt ?? params.recordedAt;
}

/**
 * `strengthAt(now, params) = strength * 0.5 ** (elapsedHours / halfLifeHours)`（ADR 0010）。
 */
function strengthAt(now: Date, params: DecayParams): number {
  const base = decayBase(params);
  const elapsedHours = (now.getTime() - base.getTime()) / MS_PER_HOUR;
  return params.strength * Math.pow(0.5, elapsedHours / params.halfLifeHours);
}

/**
 * `strengthAt` が `threshold` をちょうど下回る時刻。
 *
 * `strength <= threshold`（既に閾値以下）の場合は base をそのまま返す（ADR 0010）。
 * これは「その Memory は作成された時点で既に閾値以下だった」という状態を表し、
 * 呼び出し側から見ると過去の時刻が返る（すでに忘却対象）。
 */
function floorAt(params: DecayParams, threshold: number = DEFAULT_DECAY_THRESHOLD): Date {
  const base = decayBase(params);
  if (params.strength <= threshold) {
    return base;
  }
  const hours = params.halfLifeHours * Math.log2(params.strength / threshold);
  return new Date(base.getTime() + hours * MS_PER_HOUR);
}

export const defaultDecayStrategy: DecayStrategy = {
  strengthAt,
  floorAt,
};
