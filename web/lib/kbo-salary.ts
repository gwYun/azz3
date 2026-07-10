/**
 * Client-side port of kbo/src/salary_model.py — the WAR→₩ value curve.
 *
 * KBO does not publish per-player salaries (the open stats sites don't carry
 * them and statiz is off-limits), so this is a transparent VALUE estimate: a
 * league-minimum floor plus a convex WAR premium, with an optional age tilt
 * toward the FA/prime band. Kept numerically identical to the Python model so
 * the /kbo leaderboard and this estimator always agree.
 */

export const MIN_SALARY_WON = 30_000_000; // KBO league minimum (~₩30M)
export const WAR_SCALE_WON = 110_000_000; // ₩ per WAR^exp above replacement
export const WAR_EXP = 1.25; // mild convexity — stars paid super-linearly
export const MAX_SALARY_WON = 2_500_000_000; // annualized megadeal ceiling

/** Mild multiplier peaking around the FA/prime band (~30); 1.0 if age unknown. */
export function ageFactor(age: number | null): number {
  if (age == null || Number.isNaN(age)) return 1.0;
  const bell = 0.15 * Math.exp(-((age - 30) ** 2) / (2 * 4 ** 2)) - 0.05;
  return Math.min(1.2, Math.max(0.85, 1.0 + bell));
}

/** Raw WAR premium in won, before the floor, age tilt, and cap. */
export function warPremiumWon(war: number): number {
  return Math.pow(Math.max(0, war), WAR_EXP) * WAR_SCALE_WON;
}

/** Estimated value in won from WAR (+ optional age tilt). */
export function estSalaryWon(war: number, age: number | null = null): number {
  const val = MIN_SALARY_WON + warPremiumWon(war);
  return Math.min(MAX_SALARY_WON, Math.max(MIN_SALARY_WON, val * ageFactor(age)));
}

/** Estimated value in 억원 (won / 1e8), rounded like the Python model's display. */
export function estSalaryOk(war: number, age: number | null = null): number {
  return Math.round((estSalaryWon(war, age) / 1e8) * 100) / 100;
}

/** A representative player as carried in public/kbo.json. */
export type KboPlayer = {
  name: string;
  franchise_ko: string;
  kind: string;
  war: number;
  metric: number;
  metric_label: string;
  salary_ok: number;
};
