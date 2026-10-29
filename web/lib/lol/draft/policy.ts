/**
 * Draft policy — a conditional-logit choice model of pro picks and bans.
 *
 * At every step of the 20-step pro draft the acting team chooses one champion
 * from the still-available pool with probability ∝ exp(θ·f(c)), where f are the
 * features below (separate θ for picks and bans). θ is fit by maximum likelihood
 * on real drafts (convex; plain gradient ascent). The same model then SAMPLES
 * drafts for the Monte-Carlo (sample.ts).
 *
 * Draft order (Team1 = blue): bans B R B R B R · picks B R R B B R ·
 * bans R B R B · picks R B B R.
 */
import { ROLES, type DraftGame, type Role } from "./collect";
import type { DraftStats } from "./stats";

export type Side = "blue" | "red";
export type StepKind = "ban" | "pick";
export const DRAFT_ORDER: { side: Side; kind: StepKind; idx: number }[] = [
  { side: "blue", kind: "ban", idx: 0 }, { side: "red", kind: "ban", idx: 0 },
  { side: "blue", kind: "ban", idx: 1 }, { side: "red", kind: "ban", idx: 1 },
  { side: "blue", kind: "ban", idx: 2 }, { side: "red", kind: "ban", idx: 2 },
  { side: "blue", kind: "pick", idx: 0 }, { side: "red", kind: "pick", idx: 0 },
  { side: "red", kind: "pick", idx: 1 }, { side: "blue", kind: "pick", idx: 1 },
  { side: "blue", kind: "pick", idx: 2 }, { side: "red", kind: "pick", idx: 2 },
  { side: "red", kind: "ban", idx: 3 }, { side: "blue", kind: "ban", idx: 3 },
  { side: "red", kind: "ban", idx: 4 }, { side: "blue", kind: "ban", idx: 4 },
  { side: "red", kind: "pick", idx: 3 }, { side: "blue", kind: "pick", idx: 3 },
  { side: "blue", kind: "pick", idx: 4 }, { side: "red", kind: "pick", idx: 4 },
];

/** A side in a draft: team name and its five players by role. */
export interface DraftSide {
  team: string;
  players: Partial<Record<Role, string>>;
}

export interface DraftState {
  blue: DraftSide;
  red: DraftSide;
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
  unavailable: Set<string>; // fearless: champions already used earlier in the series
}

export const PICK_FEATURES = ["meta", "comfort", "roleFit", "teamPick", "counter", "deny"] as const;
export const BAN_FEATURES = ["meta", "threat", "teamBan", "ownComfort", "oppRoleFit"] as const;
export type Theta = { pick: number[]; ban: number[] };

const roleShare = (s: DraftStats, c: string, r: Role) => s.roleOfChamp.get(c)?.get(r) ?? 0;
const comfortOf = (s: DraftStats, player: string | undefined, c: string) =>
  player ? s.comfort.get(player)?.get(c) ?? -1 : -1;

/** Roles a side still has to fill, inferring filled roles from its picks' main role. */
export function openRoles(s: DraftStats, picks: string[]): Set<Role> {
  const open = new Set<Role>(ROLES);
  // Greedy: assign each pick to its most likely still-open role.
  for (const c of picks) {
    let best: Role | null = null, bp = -1;
    for (const r of open) { const p = roleShare(s, c, r); if (p > bp) { bp = p; best = r; } }
    if (best) open.delete(best);
  }
  return open;
}

function roleFit(s: DraftStats, c: string, open: Set<Role>): number {
  let f = 0;
  for (const r of open) f += roleShare(s, c, r);
  return f;
}

function sideComfort(s: DraftStats, side: DraftSide, c: string, open: Set<Role>): number {
  let best = -1;
  for (const r of open) {
    const sh = roleShare(s, c, r);
    if (sh < 0.15) continue;
    best = Math.max(best, comfortOf(s, side.players[r], c));
  }
  return best;
}

function counterScore(s: DraftStats, c: string, enemyPicks: string[], open: Set<Role>): number {
  let f = 0;
  for (const e of enemyPicks) {
    for (const r of open) {
      const sh = roleShare(s, c, r) * roleShare(s, e, r);
      if (sh > 0) f += sh * (s.lane.get(`${r}|${c}|${e}`) ?? 0);
    }
  }
  return f;
}

/** Per-step context shared by every candidate (computed once per step). */
export interface StepCtx {
  me: DraftSide;
  opp: DraftSide;
  oppPicks: string[];
  myOpen: Set<Role>;
  oppOpen: Set<Role>;
}

export function stepCtx(s: DraftStats, st: DraftState, side: Side): StepCtx {
  const myPicks = side === "blue" ? st.bluePicks : st.redPicks;
  const oppPicks = side === "blue" ? st.redPicks : st.bluePicks;
  return {
    me: side === "blue" ? st.blue : st.red,
    opp: side === "blue" ? st.red : st.blue,
    oppPicks,
    myOpen: openRoles(s, myPicks),
    oppOpen: openRoles(s, oppPicks),
  };
}

/** Feature vector for champion c at a step. */
export function features(s: DraftStats, ctx: StepCtx, kind: StepKind, c: string): number[] {
  const meta = s.meta.get(c) ?? -2;
  if (kind === "pick") {
    return [
      meta,
      sideComfort(s, ctx.me, c, ctx.myOpen),
      Math.log(roleFit(s, c, ctx.myOpen) + 0.01),
      s.teamPick.get(ctx.me.team)?.get(c) ?? 0,
      counterScore(s, c, ctx.oppPicks, ctx.myOpen),
      sideComfort(s, ctx.opp, c, ctx.oppOpen),
    ];
  }
  return [
    meta,
    sideComfort(s, ctx.opp, c, ctx.oppOpen),
    s.teamBan.get(ctx.me.team)?.get(c) ?? 0,
    sideComfort(s, ctx.me, c, ctx.myOpen),
    Math.log(roleFit(s, c, ctx.oppOpen) + 0.01),
  ];
}

export function available(s: DraftStats, st: DraftState): string[] {
  const taken = new Set([...st.bluePicks, ...st.redPicks, ...st.blueBans, ...st.redBans, ...st.unavailable]);
  return s.champions.filter((c) => !taken.has(c));
}

export function choiceProbs(s: DraftStats, theta: Theta, st: DraftState, side: Side, kind: StepKind, pool = available(s, st)) {
  const th = kind === "pick" ? theta.pick : theta.ban;
  const ctx = stepCtx(s, st, side);
  const u = pool.map((c) => features(s, ctx, kind, c).reduce((a, f, i) => a + f * th[i], 0));
  const m = Math.max(...u);
  const e = u.map((x) => Math.exp(x - m));
  const z = e.reduce((a, b) => a + b, 0);
  return pool.map((c, i) => ({ c, p: e[i] / z }));
}

export function emptyState(blue: DraftSide, red: DraftSide, unavailable = new Set<string>()): DraftState {
  return { blue, red, bluePicks: [], redPicks: [], blueBans: [], redBans: [], unavailable };
}

export function apply(st: DraftState, side: Side, kind: StepKind, c: string): DraftState {
  const k = `${side}${kind === "pick" ? "Picks" : "Bans"}` as "bluePicks" | "redPicks" | "blueBans" | "redBans";
  return { ...st, [k]: [...st[k], c] };
}

/** Rosters of a recorded game as DraftSides. */
export function sidesOf(g: DraftGame): { blue: DraftSide; red: DraftSide } {
  const to = (roster: DraftGame["blueRoster"], team: string): DraftSide => ({
    team, players: Object.fromEntries(roster.map((p) => [p.role, p.player])),
  });
  return { blue: to(g.blueRoster, g.blue), red: to(g.redRoster, g.red) };
}

/** Replay a recorded draft step by step: yields (state before step, step, chosen champion). */
export function* replay(g: DraftGame, unavailable = new Set<string>()) {
  const { blue, red } = sidesOf(g);
  let st = emptyState(blue, red, unavailable);
  for (const step of DRAFT_ORDER) {
    const list = step.kind === "pick" ? (step.side === "blue" ? g.bluePicks : g.redPicks) : (step.side === "blue" ? g.blueBans : g.redBans);
    const c = list[step.idx];
    if (!c) continue; // missed ban
    yield { st, step, c };
    st = apply(st, step.side, step.kind, c);
  }
}

/**
 * Fit θ by weighted maximum likelihood (gradient ascent with a small L2 prior).
 * `samples` are precomputed (features of every candidate, index of the choice).
 */
export interface ChoiceSample { X: number[][]; y: number; w: number }

export function fitChoice(samples: ChoiceSample[], dim: number, { iters = 300, lr = 0.5, l2 = 0.01 } = {}): number[] {
  const th = new Array(dim).fill(0);
  const W = samples.reduce((a, s) => a + s.w, 0) || 1;
  for (let it = 0; it < iters; it++) {
    const g = new Array(dim).fill(0);
    for (const s of samples) {
      const u = s.X.map((x) => x.reduce((a, f, i) => a + f * th[i], 0));
      const m = Math.max(...u);
      const e = u.map((v) => Math.exp(v - m));
      const z = e.reduce((a, b) => a + b, 0);
      const ex = new Array(dim).fill(0);
      s.X.forEach((x, j) => x.forEach((f, i) => { ex[i] += (e[j] / z) * f; }));
      s.X[s.y].forEach((f, i) => { g[i] += s.w * (f - ex[i]); });
    }
    for (let i = 0; i < dim; i++) th[i] += lr * (g[i] / W - l2 * th[i]);
  }
  return th;
}

export function choiceSamples(s: DraftStats, games: DraftGame[], weightOf: (g: DraftGame) => number, kind?: StepKind): { pick: ChoiceSample[]; ban: ChoiceSample[] } {
  const out = { pick: [] as ChoiceSample[], ban: [] as ChoiceSample[] };
  for (const g of games) {
    const w = weightOf(g);
    if (w <= 0 || g.bluePicks.length !== 5 || g.blueRoster.length !== 5 || g.redRoster.length !== 5) continue;
    for (const { st, step, c } of replay(g)) {
      if (kind && step.kind !== kind) continue;
      const pool = available(s, st);
      const y = pool.indexOf(c);
      if (y < 0) continue; // champion unseen in stats
      const ctx = stepCtx(s, st, step.side);
      out[step.kind].push({ X: pool.map((x) => features(s, ctx, step.kind, x)), y, w });
    }
  }
  return out;
}
