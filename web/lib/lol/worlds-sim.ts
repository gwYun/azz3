/**
 * Worlds conditional tournament sim — Swiss stage → 8-team single-elimination.
 *
 * Real results are fixed; everything not yet played is drawn from the map model
 * (p = P(A wins a map), series played out map by map so a live series continues
 * from its current score).
 *
 * Swiss (16 teams, 3 wins advance / 3 losses out): teams meet within the same
 * W-L pool, no rematches. R1–R2 Bo1; R3 Bo1 for the 1-1 pool and Bo3 for the
 * advancement / elimination pools; R4–R5 Bo3. Naver's real pairings are used as
 * soon as they're drawn; still-TBD pairings are drawn at random within pools.
 *
 * Knockout draw (not yet published): the two 3-0 teams each face a 3-2 team and
 * sit in opposite halves; the rest pair at random. QF slots are ordered by
 * Naver's start time, SF1 = QF1·QF2 winners, SF2 = QF3·QF4, all Bo5. Region
 * separation in the draw is NOT modelled.
 */
import type { LolMatchRow } from "./data";

export type Stage = { kind: "swiss"; round: number } | { kind: "qf" | "sf" | "final" } | { kind: "other" };

export function stageOf(title: string | null): Stage {
  const t = title ?? "";
  const m = t.match(/스위스\s*(\d)/);
  if (m) return { kind: "swiss", round: Number(m[1]) };
  if (t.includes("8강")) return { kind: "qf" };
  if (t.includes("4강")) return { kind: "sf" };
  if (t.includes("결승")) return { kind: "final" };
  return { kind: "other" };
}

export const STAGE_KO: Record<string, string> = { qf: "8강", sf: "4강", final: "결승" };

type PMap = (a: string, b: string) => number;

export interface TeamOdds {
  team: string;
  wins: number;          // real Swiss record so far
  losses: number;
  alive: boolean;
  swiss30: number;       // % (advance with 3-0)
  advance: number;       // % reach QF
  semis: number;
  final: number;
  champion: number;
}

export interface WorldsSimResult {
  sims: number;
  teams: TeamOdds[];     // sorted by champion odds
}

/** mulberry32 — seeded RNG so tests are deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playSeries(p: number, bestOf: number, rand: () => number, from = { a: 0, b: 0 }): boolean {
  const need = Math.ceil(bestOf / 2);
  let { a, b } = from;
  while (a < need && b < need) {
    if (rand() < p) a++; else b++;
  }
  return a >= need;
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pair a pool at random, avoiding rematches where possible (a few reshuffles, then accept). */
function pairPool(pool: string[], met: Map<string, Set<string>>, rand: () => number): [string, string][] {
  let best: [string, string][] = [];
  let bestClash = Infinity;
  for (let tries = 0; tries < 20; tries++) {
    const s = shuffle(pool, rand);
    const pairs: [string, string][] = [];
    let clash = 0;
    for (let i = 0; i + 1 < s.length; i += 2) {
      pairs.push([s[i], s[i + 1]]);
      if (met.get(s[i])?.has(s[i + 1])) clash++;
    }
    if (clash < bestClash) { best = pairs; bestClash = clash; }
    if (clash === 0) break;
  }
  return best;
}

const known = (m: LolMatchRow) => m.home_team !== "TBD" && m.away_team !== "TBD";
const done = (m: LolMatchRow) => m.status === "RESULT" && m.home_score !== m.away_score;
const winnerOf = (m: LolMatchRow) => (m.home_score > m.away_score ? m.home_team : m.away_team);

export function swissBestOf(round: number, w: number, l: number): number {
  if (round <= 2) return 1;
  if (round === 3) return w === l ? 1 : 3;
  return 3;
}

/** Real Swiss W-L per team from finished Swiss series. */
export function swissRecords(matches: LolMatchRow[]): Map<string, { w: number; l: number }> {
  const rec = new Map<string, { w: number; l: number }>();
  for (const m of matches) {
    const st = stageOf(m.title);
    if (st.kind !== "swiss" || !known(m)) continue;
    for (const t of [m.home_team, m.away_team]) if (!rec.has(t)) rec.set(t, { w: 0, l: 0 });
    if (!done(m)) continue;
    const win = winnerOf(m);
    const lose = win === m.home_team ? m.away_team : m.home_team;
    rec.get(win)!.w++;
    rec.get(lose)!.l++;
  }
  return rec;
}

export function simulateWorlds(
  matches: LolMatchRow[],
  pMap: PMap,
  { sims = 20000, seed = 20261026 }: { sims?: number; seed?: number } = {},
): WorldsSimResult {
  const rand = rng(seed);
  const byStart = [...matches].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const swissByRound = new Map<number, LolMatchRow[]>();
  const ko: Record<"qf" | "sf" | "final", LolMatchRow[]> = { qf: [], sf: [], final: [] };
  for (const m of byStart) {
    const st = stageOf(m.title);
    if (st.kind === "swiss") swissByRound.set(st.round, [...(swissByRound.get(st.round) ?? []), m]);
    else if (st.kind === "qf" || st.kind === "sf" || st.kind === "final") ko[st.kind].push(m);
  }
  const swissTeams = [...new Set((swissByRound.get(1) ?? []).filter(known).flatMap((m) => [m.home_team, m.away_team]))];
  const real = swissRecords(matches);

  const cnt = new Map(swissTeams.map((t) => [t, { s30: 0, adv: 0, sf: 0, fin: 0, champ: 0 }]));

  // One series between a and b: real result if finished, else simulated (from a live score).
  const play = (a: string, b: string, bestOf: number, row?: LolMatchRow): string => {
    if (row && done(row)) return winnerOf(row);
    const from = row && row.status === "STARTED"
      ? (row.home_team === a ? { a: row.home_score, b: row.away_score } : { a: row.away_score, b: row.home_score })
      : { a: 0, b: 0 };
    return playSeries(pMap(a, b), bestOf, rand, from) ? a : b;
  };

  for (let s = 0; s < sims; s++) {
    const w = new Map(swissTeams.map((t) => [t, 0]));
    const l = new Map(swissTeams.map((t) => [t, 0]));
    const met = new Map(swissTeams.map((t) => [t, new Set<string>()]));
    const result = (win: string, lose: string) => {
      w.set(win, w.get(win)! + 1);
      l.set(lose, l.get(lose)! + 1);
      met.get(win)!.add(lose);
      met.get(lose)!.add(win);
    };
    for (let r = 1; r <= 5; r++) {
      const active = swissTeams.filter((t) => w.get(t)! < 3 && l.get(t)! < 3);
      const paired = new Set<string>();
      for (const m of (swissByRound.get(r) ?? []).filter(known)) {
        const bo = m.best_of || swissBestOf(r, w.get(m.home_team)!, l.get(m.home_team)!);
        const win = play(m.home_team, m.away_team, bo, m);
        result(win, win === m.home_team ? m.away_team : m.home_team);
        paired.add(m.home_team).add(m.away_team);
      }
      const pools = new Map<string, string[]>();
      for (const t of active) {
        if (paired.has(t)) continue;
        const k = `${w.get(t)}-${l.get(t)}`;
        pools.set(k, [...(pools.get(k) ?? []), t]);
      }
      for (const pool of pools.values()) {
        for (const [a, b] of pairPool(pool, met, rand)) {
          const win = play(a, b, swissBestOf(r, w.get(a)!, l.get(a)!));
          result(win, win === a ? b : a);
        }
      }
    }
    const qualified = swissTeams.filter((t) => w.get(t)! >= 3);
    for (const t of qualified) {
      const c = cnt.get(t)!;
      c.adv++;
      if (l.get(t) === 0) c.s30++;
    }

    // Knockout draw → QF slots 0..3.
    const slots: [string, string][] = [];
    const realQf = ko.qf.filter(known);
    if (realQf.length === ko.qf.length && realQf.length === 4) {
      for (const m of realQf) slots.push([m.home_team, m.away_team]);
    } else if (qualified.length === 8) {
      const placed = new Set(realQf.flatMap((m) => [m.home_team, m.away_team]));
      const free = qualified.filter((t) => !placed.has(t));
      const a30 = shuffle(free.filter((t) => l.get(t) === 0), rand);
      const c32 = shuffle(free.filter((t) => l.get(t) === 2), rand);
      const pairs: [string, string][] = [];
      for (const t of a30) {
        const opp = c32.length ? c32.pop()! : null;
        if (opp) pairs.push([t, opp]);
      }
      const rest = shuffle(free.filter((t) => !pairs.some((p) => p.includes(t))), rand);
      const restPairs: [string, string][] = [];
      for (let i = 0; i + 1 < rest.length; i += 2) restPairs.push([rest[i], rest[i + 1]]);
      // 3-0 matches in opposite halves (slots 0 and 2), others fill the gaps.
      const fill: ([string, string] | null)[] = [null, null, null, null];
      realQf.forEach((m, i) => { fill[ko.qf.indexOf(m) >= 0 ? ko.qf.indexOf(m) : i] = [m.home_team, m.away_team]; });
      const order = [...pairs, ...shuffle(restPairs, rand)];
      for (const target of [0, 2, 1, 3]) if (!fill[target]) fill[target] = order.shift() ?? null;
      for (const f of fill) if (f) slots.push(f);
    }
    if (slots.length !== 4) continue;

    const qfW = slots.map(([a, b], i) => play(a, b, 5, ko.qf[i] && known(ko.qf[i]) ? ko.qf[i] : undefined));
    const sfPairs: [string, string][] = [[qfW[0], qfW[1]], [qfW[2], qfW[3]]];
    const sfW = sfPairs.map(([a, b], i) => {
      const row = ko.sf[i] && known(ko.sf[i]) ? ko.sf[i] : undefined;
      return row ? play(row.home_team, row.away_team, 5, row) : play(a, b, 5);
    });
    const fRow = ko.final[0] && known(ko.final[0]) ? ko.final[0] : undefined;
    const champ = fRow ? play(fRow.home_team, fRow.away_team, 5, fRow) : play(sfW[0], sfW[1], 5);
    for (const t of qfW) cnt.get(t) && cnt.get(t)!.sf++;
    for (const t of sfW) cnt.get(t) && cnt.get(t)!.fin++;
    if (cnt.get(champ)) cnt.get(champ)!.champ++;
  }

  const pct = (x: number) => Number(((100 * x) / sims).toFixed(1));
  const koLosers = new Set(
    [...ko.qf, ...ko.sf, ...ko.final].filter((m) => known(m) && done(m))
      .map((m) => (winnerOf(m) === m.home_team ? m.away_team : m.home_team)),
  );
  const teams: TeamOdds[] = swissTeams.map((t) => {
    const c = cnt.get(t)!;
    const r = real.get(t) ?? { w: 0, l: 0 };
    return {
      team: t, wins: r.w, losses: r.l, alive: r.l < 3 && !koLosers.has(t),
      swiss30: pct(c.s30), advance: pct(c.adv), semis: pct(c.sf), final: pct(c.fin), champion: pct(c.champ),
    };
  });
  teams.sort((a, b) => b.champion - a.champion || b.advance - a.advance);
  return { sims, teams };
}
