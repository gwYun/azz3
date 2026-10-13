/**
 * Conditional KBO postseason sim — the bracket AS IT STANDS: series results so
 * far are fixed, only the remaining games are simulated.
 *
 * Format (PROJECT_KNOWLEDGE §5; same as season-sim.ts / kbo/src/postseason.py):
 *   WC  seed4 vs seed5 — up to 2 games, both hosted by seed4; seed4 needs 1 win,
 *       seed5 must win both.
 *   SPO seed3 vs WC winner — best-of-5, higher seed hosts games 1,2,5 (2-2-1).
 *   PO  seed2 vs SPO winner — best-of-5 (2-2-1).
 *   KS  seed1 vs PO winner — best-of-7, higher seed hosts 1,2,6,7 (2-3-2).
 *
 * Game model = the project's: expectedRuns() + decisive NegBinom win prob
 * (winProbExact), on regular-season run rates shrunk toward the league mean.
 * Postseason ties (15-inning cap) are rare and not modelled.
 */
import { winProbExact } from "./matchup-sim";
import { expectedRuns, DISPERSION_K } from "./season-sim";
import type { PostseasonRound } from "./postseason-ids";

export const ROUNDS: PostseasonRound[] = ["WC", "SPO", "PO", "KS"];
const NEED: Record<PostseasonRound, number> = { WC: 2, SPO: 3, PO: 3, KS: 4 };
const PATTERN: Record<PostseasonRound, ("H" | "A")[]> = {
  WC: ["H", "H"],
  SPO: ["H", "H", "A", "A", "H"],
  PO: ["H", "H", "A", "A", "H"],
  KS: ["H", "H", "A", "A", "A", "H", "H"],
};

export interface PsTeam {
  team: string;
  rsRate: number; // shrunk runs scored / game
  raRate: number; // shrunk runs allowed / game
}

export interface PsGame {
  round: PostseasonRound;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

export interface SeriesState {
  round: PostseasonRound;
  higher: string | null; // higher seed (null until the lower-round winner is known)
  lower: string | null;
  higherWins: number;
  lowerWins: number;
  /** For the WC the higher seed starts with a 1-win edge: it needs 1, seed5 needs 2. */
  higherNeeds: number;
  lowerNeeds: number;
  winner: string | null; // decided by real results
  gamesPlayed: number;
}

export interface PsTeamOdds {
  team: string;
  seed: number;
  reachSPO: number; // % (seeds 1–3 reach automatically → 100 when relevant)
  reachPO: number;
  reachKS: number;
  champion: number;
  alive: boolean;
}

export interface PsResult {
  series: (SeriesState & { pHigher: number })[]; // % the higher seed wins the series (vs whoever arrives)
  teams: PsTeamOdds[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** P(home team wins one decisive game). */
export function gameWinProb(home: PsTeam, away: PsTeam, lgRg: number): number {
  const muH = expectedRuns(home.rsRate, away.raRate, lgRg, true);
  const muA = expectedRuns(away.rsRate, home.raRate, lgRg, false);
  return winProbExact(muH, muA, DISPERSION_K);
}

/** Who hosts game number `n` (0-based) of a series. */
export function hostOf(round: PostseasonRound, n: number, higher: string, lower: string): string {
  return (PATTERN[round][n] ?? "H") === "H" ? higher : lower;
}

/** Series states from the seeds + finished postseason games (decisive ones count). */
export function seriesStates(seeds: string[], games: PsGame[]): SeriesState[] {
  const [s1, s2, s3, s4, s5] = seeds;
  const out: SeriesState[] = [];
  let carry: string | null = null; // winner of the previous round
  for (const round of ROUNDS) {
    const higher = round === "WC" ? s4 : round === "SPO" ? s3 : round === "PO" ? s2 : s1;
    const lower: string | null = round === "WC" ? s5 : carry;
    const higherNeeds = round === "WC" ? 1 : NEED[round];
    const lowerNeeds = NEED[round];
    let hw = 0, lw = 0, played = 0;
    for (const g of games) {
      if (g.round !== round || g.homeScore === g.awayScore) continue;
      const w = g.homeScore > g.awayScore ? g.home : g.away;
      played++;
      if (w === higher) hw++;
      else if (lower && w === lower) lw++;
    }
    const winner: string | null = hw >= higherNeeds ? higher : lower && lw >= lowerNeeds ? lower : null;
    out.push({ round, higher, lower, higherWins: hw, lowerWins: lw, higherNeeds, lowerNeeds, winner, gamesPlayed: played });
    carry = winner;
  }
  return out;
}

export function simulatePostseason(
  seeds: string[],
  rates: PsTeam[],
  lgRg: number,
  games: PsGame[],
  opts: { sims?: number; seed?: number } = {},
): PsResult {
  const sims = opts.sims ?? 40000;
  const rand = mulberry32(opts.seed ?? 42);
  const byTeam = new Map(rates.map((r) => [r.team, r]));
  const pHome = new Map<string, number>();
  const pWin = (home: string, away: string) => {
    const k = `${home}|${away}`;
    let p = pHome.get(k);
    if (p == null) {
      p = gameWinProb(byTeam.get(home)!, byTeam.get(away)!, lgRg);
      pHome.set(k, p);
    }
    return p;
  };

  const states = seriesStates(seeds, games);
  const count = (m: Map<string, number>, t: string) => m.set(t, (m.get(t) ?? 0) + 1);
  const reach = { SPO: new Map<string, number>(), PO: new Map<string, number>(), KS: new Map<string, number>() };
  const champ = new Map<string, number>();
  const higherWon = ROUNDS.map(() => 0);
  const contested = ROUNDS.map(() => 0);

  for (let s = 0; s < sims; s++) {
    let carry: string | null = null;
    for (let r = 0; r < ROUNDS.length; r++) {
      const st = states[r];
      const round = st.round;
      const higher = st.higher!;
      const lower: string = r === 0 ? st.lower! : st.lower ?? carry!; // known lower side, else this draw's winner
      let winner: string;
      if (st.winner && (r === 0 || st.lower)) {
        winner = st.winner;
      } else {
        // Continue from the real series state only if this draw matches the real matchup.
        const real = st.lower != null && lower === st.lower;
        let hw = real ? st.higherWins : 0;
        let lw = real ? st.lowerWins : 0;
        let n = real ? st.gamesPlayed : 0;
        while (hw < st.higherNeeds && lw < st.lowerNeeds) {
          const host = hostOf(round, n, higher, lower);
          const guest = host === higher ? lower : higher;
          const hostWins = rand() < pWin(host, guest);
          if ((hostWins ? host : guest) === higher) hw++; else lw++;
          n++;
        }
        winner = hw >= st.higherNeeds ? higher : lower;
      }
      contested[r]++;
      if (winner === higher) higherWon[r]++;
      if (round === "WC") count(reach.SPO, winner);
      if (round === "SPO") count(reach.PO, winner);
      if (round === "PO") count(reach.KS, winner);
      if (round === "KS") count(champ, winner);
      carry = winner;
    }
  }

  const pct = (m: Map<string, number>, t: string) => Number(((100 * (m.get(t) ?? 0)) / sims).toFixed(1));
  // Byes count as "reached": seeds 1–3 skip the WC, seeds 1–2 the SPO, seed 1 the PO.
  const teams: PsTeamOdds[] = seeds.slice(0, 5).map((t, i) => ({
    team: t,
    seed: i + 1,
    reachSPO: i <= 2 ? 100 : pct(reach.SPO, t),
    reachPO: i <= 1 ? 100 : pct(reach.PO, t),
    reachKS: i === 0 ? 100 : pct(reach.KS, t),
    champion: pct(champ, t),
    alive: true,
  }));
  // Knocked out by a real result → dead.
  for (const st of states) {
    if (!st.winner) continue;
    const loser = st.winner === st.higher ? st.lower : st.higher;
    const t = teams.find((x) => x.team === loser);
    if (t) t.alive = false;
  }

  return {
    series: states.map((st, r) => ({
      ...st,
      pHigher: Number(((100 * higherWon[r]) / Math.max(contested[r], 1)).toFixed(1)),
    })),
    teams,
  };
}
