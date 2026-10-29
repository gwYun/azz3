/**
 * Draft Monte-Carlo + composition win model.
 *
 * Composition model: given a finished draft (roles assigned greedily from each
 * champion's role shares),
 *
 *   logit P(blue wins) = β0 + βr·ratingDiff + βm·Σmeta + βc·Σcomfort + βl·Σlane
 *
 * where every Σ is blue minus red and ratingDiff is the team-strength log-odds
 * from the series model. β is fit by weighted logistic regression.
 *
 * Pre-draft odds = mean of the composition model over sampled drafts (the
 * policy in policy.ts plays both sides). Scenarios FORCE a champion into a
 * side's picks or remove it (banned / used under fearless) and re-run.
 */
import { ROLES, type Role } from "./collect";
import type { DraftStats } from "./stats";
import {
  DRAFT_ORDER, apply, available, choiceProbs, emptyState,
  type DraftSide, type DraftState, type Side, type Theta,
} from "./policy";

export const COMP_FEATURES = ["rating", "meta", "comfort", "lane"] as const;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Assign a side's 5 picks to roles (most constrained first). */
export function assignRoles(s: DraftStats, picks: string[]): Map<Role, string> {
  const out = new Map<Role, string>();
  const share = (c: string, r: Role) => s.roleOfChamp.get(c)?.get(r) ?? 0;
  const left = [...picks];
  while (left.length) {
    let best: { c: string; r: Role; p: number } | null = null;
    for (const c of left) for (const r of ROLES) {
      if (out.has(r)) continue;
      const p = share(c, r);
      if (!best || p > best.p) best = { c, r, p };
    }
    if (!best) break;
    out.set(best.r, best.c);
    left.splice(left.indexOf(best.c), 1);
  }
  return out;
}

export interface CompBreakdown {
  meta: number;
  comfort: number;
  lane: number;
  byRole: Record<Role, { meta: number; comfort: number; lane: number }>;
}

/** Blue-minus-red composition terms, total and per role (the "key lane" signal). */
export function compBreakdown(s: DraftStats, st: DraftState): CompBreakdown {
  const b = assignRoles(s, st.bluePicks);
  const r = assignRoles(s, st.redPicks);
  const byRole = {} as CompBreakdown["byRole"];
  let meta = 0, comfort = 0, lane = 0;
  for (const role of ROLES) {
    const cb = b.get(role), cr = r.get(role);
    const m = (cb ? s.meta.get(cb) ?? 0 : 0) - (cr ? s.meta.get(cr) ?? 0 : 0);
    const cf = (cb ? s.comfort.get(st.blue.players[role] ?? "")?.get(cb) ?? -1 : 0)
      - (cr ? s.comfort.get(st.red.players[role] ?? "")?.get(cr) ?? -1 : 0);
    const l = cb && cr ? s.lane.get(`${role}|${cb}|${cr}`) ?? 0 : 0;
    byRole[role] = { meta: m, comfort: cf, lane: l };
    meta += m; comfort += cf; lane += l;
  }
  return { meta, comfort, lane, byRole };
}

export function compX(ratingDiff: number, c: CompBreakdown): number[] {
  return [ratingDiff, c.meta, c.comfort, c.lane];
}

export interface WinModel { b0: number; beta: number[] }

export function winProb(m: WinModel, x: number[]): number {
  return sigmoid(m.b0 + x.reduce((a, v, i) => a + v * m.beta[i], 0));
}

/** Weighted logistic regression (Newton, small ridge). */
export function fitWin(rows: { x: number[]; y: number; w: number }[], ridge = 1): WinModel {
  const d = rows[0]?.x.length ?? 0;
  const P = d + 1;
  let th = new Array(P).fill(0);
  for (let it = 0; it < 25; it++) {
    const g = new Array(P).fill(0);
    const H = Array.from({ length: P }, () => new Array(P).fill(0));
    for (const r of rows) {
      const z = [1, ...r.x];
      const p = sigmoid(z.reduce((a, v, i) => a + v * th[i], 0));
      for (let i = 0; i < P; i++) {
        g[i] += r.w * (r.y - p) * z[i];
        for (let j = 0; j < P; j++) H[i][j] += r.w * p * (1 - p) * z[i] * z[j];
      }
    }
    for (let i = 1; i < P; i++) { g[i] -= ridge * th[i]; H[i][i] += ridge; }
    H[0][0] += 1e-6;
    const step = solve(H, g);
    th = th.map((v, i) => v + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return { b0: th[0], beta: th.slice(1) };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

// --------------------------------------------------------------------------- //
// Sampling.                                                                   //
// --------------------------------------------------------------------------- //

export interface Force {
  /** Champion that must end up in this side's picks (taken at its first pick step). */
  pick?: { side: Side; champion: string };
  /** Champions removed from the pool (banned / fearless-used). */
  remove?: string[];
}

function sampleFrom(ps: { c: string; p: number }[], rand: () => number): string {
  let u = rand();
  for (const x of ps) { u -= x.p; if (u <= 0) return x.c; }
  return ps[ps.length - 1].c;
}

export function sampleDraft(
  s: DraftStats, theta: Theta, blue: DraftSide, red: DraftSide, rand: () => number,
  { unavailable = new Set<string>(), force = {} as Force } = {},
): DraftState {
  const gone = new Set([...unavailable, ...(force.remove ?? [])]);
  let st = emptyState(blue, red, gone);
  let forcedDone = !force.pick;
  for (const step of DRAFT_ORDER) {
    let pool = available(s, st);
    if (force.pick && pool.includes(force.pick.champion) && !(step.kind === "pick" && step.side === force.pick.side)) {
      pool = pool.filter((c) => c !== force.pick!.champion); // nobody else may take/ban it
    }
    let c: string;
    if (!forcedDone && step.kind === "pick" && step.side === force.pick!.side) {
      c = force.pick!.champion;
      forcedDone = true;
    } else {
      c = sampleFrom(choiceProbs(s, theta, st, step.side, step.kind, pool), rand);
    }
    st = apply(st, step.side, step.kind, c);
  }
  return st;
}

export interface DraftForecast {
  pBlue: number;                           // mean composition win prob for blue
  banRate: Map<string, { blue: number; red: number }>;
  pickRate: Map<string, { blue: number; red: number }>;
  firstPick: Map<string, number>;          // blue's first pick distribution
  roleEdge: Record<Role, number>;          // mean blue-minus-red log-odds contribution per role
  drafts: { st: DraftState; p: number }[]; // a few samples (for "likely drafts")
}

export function forecastGame(
  s: DraftStats, theta: Theta, wm: WinModel, ratingDiff: number,
  blue: DraftSide, red: DraftSide, rand: () => number,
  { n = 300, unavailable = new Set<string>(), force = {} as Force } = {},
): DraftForecast {
  const banRate = new Map<string, { blue: number; red: number }>();
  const pickRate = new Map<string, { blue: number; red: number }>();
  const firstPick = new Map<string, number>();
  const roleEdge = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const drafts: DraftForecast["drafts"] = [];
  let sum = 0;
  const bump = (m: Map<string, { blue: number; red: number }>, c: string, side: Side) => {
    const e = m.get(c) ?? { blue: 0, red: 0 };
    e[side] += 1 / n;
    m.set(c, e);
  };
  for (let i = 0; i < n; i++) {
    const st = sampleDraft(s, theta, blue, red, rand, { unavailable, force });
    const br = compBreakdown(s, st);
    const p = winProb(wm, compX(ratingDiff, br));
    sum += p;
    for (const c of st.blueBans) bump(banRate, c, "blue");
    for (const c of st.redBans) bump(banRate, c, "red");
    for (const c of st.bluePicks) bump(pickRate, c, "blue");
    for (const c of st.redPicks) bump(pickRate, c, "red");
    firstPick.set(st.bluePicks[0], (firstPick.get(st.bluePicks[0]) ?? 0) + 1 / n);
    for (const r of ROLES) {
      const b = br.byRole[r];
      roleEdge[r] += (wm.beta[1] * b.meta + wm.beta[2] * b.comfort + wm.beta[3] * b.lane) / n;
    }
    if (drafts.length < 50) drafts.push({ st, p });
  }
  return { pBlue: sum / n, banRate, pickRate, firstPick, roleEdge, drafts };
}
