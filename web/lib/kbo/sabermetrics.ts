/**
 * In-house KBO sabermetrics — TypeScript port of kbo/src/sabermetrics.py +
 * league_constants.py. The daily cron recomputes wOBA/wRC+/FIP/WAR from the
 * fresh Naver raw counts here so the served metrics stay the project's own
 * (never Naver's published numbers — those are cross-check only).
 *
 * Parity: given identical inputs + constants, every function reproduces the
 * Python reference to floating-point precision (see sabermetrics.test.ts, which
 * checks against a Python-generated fixture). The only KBO-borrowed numbers are
 * the wOBA event weights; everything scaling them to runs/wins is KBO-derived.
 */

// Standard wOBA event weights (marginal run values; near-invariant across run envs).
export const WOBA_WEIGHTS = {
  BB: 0.69, HBP: 0.72, "1B": 0.88, "2B": 1.24, "3B": 1.56, HR: 2.08,
} as const;

export const REPLACEMENT_RUNS_PER_600PA = 20.0;
export const REPLACEMENT_FIP_FACTOR = 1.1;
const RPW_ANCHOR_RPW = 10.0;
const RPW_ANCHOR_RPG = 4.5;

export interface Constants {
  season: number;
  lg_wOBA: number;
  wOBA_scale: number;
  lg_OBP: number;
  lg_R_per_PA: number;
  lg_R_per_G: number;
  lg_ERA: number;
  lg_FIP: number;
  FIP_const: number;
  RPW: number;
  replacement_runs_per_600pa: number;
  replacement_fip_factor: number;
}

export interface BatLine {
  PA: number; AB: number;
  B1: number; B2: number; B3: number; HR: number;
  BB: number; IBB: number; HBP: number; SF: number;
}

export interface PitLine {
  IP: number; HR: number; BB: number; HBP: number; SO: number;
}

export interface LeagueBatTotals {
  PA: number; AB: number; H: number;
  B1: number; B2: number; B3: number; HR: number;
  BB: number; IBB: number; HBP: number; SF: number; R: number;
}

export interface LeaguePitTotals {
  IP: number; ER: number; HR: number; BB: number; HBP: number; SO: number;
}

// --------------------------------------------------------------------------- //
// Player metrics.                                                             //
// --------------------------------------------------------------------------- //

export function woba(b: BatLine, c: Constants): number | null {
  const w = WOBA_WEIGHTS;
  const uBB = b.BB - b.IBB;
  const num =
    w.BB * uBB + w.HBP * b.HBP + w["1B"] * b.B1 +
    w["2B"] * b.B2 + w["3B"] * b.B3 + w.HR * b.HR;
  const den = b.AB + b.BB - b.IBB + b.SF + b.HBP;
  return den === 0 ? null : num / den;
}

export function wraa(b: BatLine, c: Constants): number | null {
  const wo = woba(b, c);
  if (wo == null) return null;
  return ((wo - c.lg_wOBA) / c.wOBA_scale) * b.PA;
}

export function wrcPlus(b: BatLine, c: Constants): number | null {
  if (b.PA === 0) return null;
  const wr = wraa(b, c);
  if (wr == null) return null;
  const wrcPerPa = wr / b.PA + c.lg_R_per_PA;
  return (100.0 * wrcPerPa) / c.lg_R_per_PA;
}

export function battingWar(b: BatLine, c: Constants): number | null {
  const wr = wraa(b, c);
  if (wr == null) return null;
  const rar = wr + (b.PA / 600.0) * c.replacement_runs_per_600pa;
  return rar / c.RPW;
}

export function fip(p: PitLine, c: Constants): number | null {
  if (p.IP === 0) return null;
  return (13 * p.HR + 3 * (p.BB + p.HBP) - 2 * p.SO) / p.IP + c.FIP_const;
}

export function pitchingWar(p: PitLine, c: Constants): number | null {
  const f = fip(p, c);
  if (f == null) return null;
  const replFip = c.lg_FIP * c.replacement_fip_factor;
  const runsAboveRepl = (replFip - f) * (p.IP / 9.0);
  return runsAboveRepl / c.RPW;
}

// --------------------------------------------------------------------------- //
// League constants from raw totals — mirrors league_constants.constants_from_totals.
// --------------------------------------------------------------------------- //

export function constantsFromTotals(
  season: number,
  bat: LeagueBatTotals,
  pit: LeaguePitTotals,
  teamGamesTotal: number,
): Constants {
  const w = WOBA_WEIGHTS;
  const wobaNum =
    w.BB * (bat.BB - bat.IBB) + w.HBP * bat.HBP + w["1B"] * bat.B1 +
    w["2B"] * bat.B2 + w["3B"] * bat.B3 + w.HR * bat.HR;
  const lg_wOBA = wobaNum / (bat.AB + bat.BB - bat.IBB + bat.SF + bat.HBP);
  const lg_OBP = (bat.H + bat.BB + bat.HBP) / (bat.AB + bat.BB + bat.HBP + bat.SF);
  const lg_ERA = (pit.ER * 9.0) / pit.IP;
  const FIP_const =
    lg_ERA - (13 * pit.HR + 3 * (pit.BB + pit.HBP) - 2 * pit.SO) / pit.IP;
  const lg_R_per_G = bat.R / teamGamesTotal;

  // Match the Python rounding so constants (and everything derived) agree exactly.
  const r = (x: number, d: number) => Number(x.toFixed(d));
  return {
    season,
    lg_wOBA: r(lg_wOBA, 5),
    wOBA_scale: r(lg_OBP / lg_wOBA, 5),
    lg_OBP: r(lg_OBP, 5),
    lg_R_per_PA: r(bat.R / bat.PA, 5),
    lg_R_per_G: r(lg_R_per_G, 4),
    lg_ERA: r(lg_ERA, 4),
    lg_FIP: r(lg_ERA, 4),
    FIP_const: r(FIP_const, 4),
    RPW: r((RPW_ANCHOR_RPW * lg_R_per_G) / RPW_ANCHOR_RPG, 3),
    replacement_runs_per_600pa: REPLACEMENT_RUNS_PER_600PA,
    replacement_fip_factor: REPLACEMENT_FIP_FACTOR,
  };
}
