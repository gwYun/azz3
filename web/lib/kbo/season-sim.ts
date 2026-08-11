/**
 * Lean team-rating season simulator — the in-cron KBO forecast.
 *
 * Faithful to the Python engine's game + postseason model (kbo/src/game_model.py,
 * postseason.py) but driven by each team's fresh season-to-date run rates instead
 * of the full bottom-up player build. Ratings are shrunk toward the league mean
 * (the rating_shrink=0.70 lever from the 2026 recalibration) to curb the
 * overconfident-favorite bias documented in the validation.
 *
 * Speed: per-pairing outcome probabilities are computed ONCE analytically (via the
 * NegBinom PMF already in matchup-sim.ts), then each simulated season is fast
 * categorical draws — so a reduced-draw Monte-Carlo runs comfortably in a serverless
 * function.
 */
import { negBinomPmf, winProbExact } from "../matchup-sim";

// Calibrated game constants (kbo/src/game_model.py — pooled 2015-2019 + 2026).
export const DISPERSION_K = 3.7;
export const HOME_FACTOR = 1.086;
const LAM_LO = 0.25;
const LAM_HI = 20.0;
// Pull team rates toward the league anchor (fixes overconfident favorites; matches
// team_build.build_team_ratings(rating_shrink=0.70) confirmed on 2026).
export const DEFAULT_SHRINK = 0.7;

// Round-robin: 16 games vs each of 9 opponents = 144; split 8 home / 8 away.
const GAMES_PER_HOME_PAIR = 8;
// Higher-seed home pattern per round ('H' = higher seed hosts).
const BO5: ("H" | "A")[] = ["H", "H", "A", "A", "H"]; // 2-2-1
const BO7: ("H" | "A")[] = ["H", "H", "A", "A", "A", "H", "H"]; // 2-3-2

export interface TeamRate {
  team: string;
  rsRate: number; // runs scored per game (season to date)
  raRate: number; // runs allowed per game
}

export interface TeamSimResult {
  team: string;
  rank: number;
  proj_wins: number;
  first: number; // % regular-season 1st
  playoff: number; // % top-5 (가을야구)
  pennant: number; // % reaching the Korean Series
  championship: number; // % KS champion
  off_rating: number; // 100 = league avg
  def_rating: number; // 100 = league avg (higher = fewer runs allowed)
  rs_per_game: number; // shrunk rate the sim used
  ra_per_game: number;
}

function clip(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** E[runs] = offense × opp-defense / league R/G, home-boosted (game_model.expected_runs). */
export function expectedRuns(rsOff: number, raDefOpp: number, lgRg: number, home: boolean): number {
  const lam = (rsOff * raDefOpp) / lgRg * (home ? HOME_FACTOR : 1);
  return clip(lam, LAM_LO, LAM_HI);
}

/** {pHome, pAway, pTie} for one regular-season game (ties kept — KBO win% excludes them). */
function regularProbs(muHome: number, muAway: number, k: number, cap = 25) {
  const ph = negBinomPmf(muHome, k, cap);
  const pa = negBinomPmf(muAway, k, cap);
  let home = 0, tie = 0;
  for (let rh = 0; rh <= cap; rh++) {
    for (let ra = 0; ra <= cap; ra++) {
      const m = ph[rh] * pa[ra];
      if (rh > ra) home += m;
      else if (rh === ra) tie += m;
    }
  }
  return { pHome: home, pTie: tie, pAway: 1 - home - tie };
}

// Small seeded PRNG (mulberry32) so runs are reproducible/testable.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate the season `sims` times from team run rates. Returns per-team odds +
 * projected wins, ranked by projected wins (matches kbo.json's ordering).
 */
export function simulateSeason(
  teams: TeamRate[],
  opts: { sims?: number; shrink?: number; seed?: number } = {},
): TeamSimResult[] {
  const n = teams.length;
  const sims = opts.sims ?? 40000;
  const shrink = opts.shrink ?? DEFAULT_SHRINK;
  const seed = opts.seed ?? 42;
  const rand = mulberry32(seed);

  const lgRg =
    (teams.reduce((a, t) => a + t.rsRate, 0) + teams.reduce((a, t) => a + t.raRate, 0)) /
    (2 * n);

  // Shrink each team's rates toward the league anchor.
  const rs = teams.map((t) => lgRg + shrink * (t.rsRate - lgRg));
  const ra = teams.map((t) => lgRg + shrink * (t.raRate - lgRg));

  // Precompute regular-season outcome probs and postseason home-win probs.
  const reg: { pHome: number; pTie: number; pAway: number }[][] = [];
  const pHomeWin: number[][] = []; // pHomeWin[i][j] = P(i beats j | i hosts), decisive
  for (let i = 0; i < n; i++) {
    reg[i] = []; pHomeWin[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) { reg[i][j] = { pHome: 0, pTie: 0, pAway: 0 }; pHomeWin[i][j] = 0.5; continue; }
      const muH = expectedRuns(rs[i], ra[j], lgRg, true);
      const muA = expectedRuns(rs[j], ra[i], lgRg, false);
      reg[i][j] = regularProbs(muH, muA, DISPERSION_K);
      pHomeWin[i][j] = winProbExact(muH, muA, DISPERSION_K);
    }
  }

  // higher-seed wins a single game in `slot`.
  const higherWinsGame = (hi: number, lo: number, slot: "H" | "A"): boolean =>
    slot === "H" ? rand() < pHomeWin[hi][lo] : rand() < 1 - pHomeWin[lo][hi];

  const series = (hi: number, lo: number, need: number, pattern: ("H" | "A")[]): boolean => {
    let hw = 0, lw = 0;
    for (const slot of pattern) {
      if (higherWinsGame(hi, lo, slot)) hw++; else lw++;
      if (hw === need || lw === need) break;
    }
    return hw === need;
  };

  const projWins = new Float64Array(n);
  const firstCt = new Float64Array(n);
  const playoffCt = new Float64Array(n);
  const pennantCt = new Float64Array(n);
  const champCt = new Float64Array(n);

  const W = new Int32Array(n), L = new Int32Array(n);
  const order = Array.from({ length: n }, (_, i) => i);

  for (let s = 0; s < sims; s++) {
    W.fill(0); L.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const { pHome, pTie } = reg[i][j];
        const winThr = pHome, loseThr = pHome + (1 - pHome - pTie); // pHome + pAway
        for (let g = 0; g < GAMES_PER_HOME_PAIR; g++) {
          const r = rand();
          if (r < winThr) { W[i]++; L[j]++; }
          else if (r < loseThr) { L[i]++; W[j]++; }
          // else tie: no W/L change
        }
      }
    }

    // Rank by win% (ties excluded), tiebreak by wins.
    order.sort((x, y) => {
      const wx = W[x] / (W[x] + L[x] || 1), wy = W[y] / (W[y] + L[y] || 1);
      return wy - wx || W[y] - W[x] || x - y;
    });
    for (let r = 0; r < n; r++) {
      const t = order[r];
      projWins[t] += W[t];
      if (r === 0) firstCt[t]++;
      if (r < 5) playoffCt[t]++;
    }

    // Postseason stepladder on the top-5 seeds.
    const [s1, s2, s3, s4, s5] = order;
    // Wild Card: seed4 hosts both, advances unless seed5 wins both.
    const s4adv = higherWinsGame(s4, s5, "H") || higherWinsGame(s4, s5, "H");
    const wc = s4adv ? s4 : s5;
    const spo = series(s3, wc, 3, BO5) ? s3 : wc;
    const po = series(s2, spo, 3, BO5) ? s2 : spo;
    const champ = series(s1, po, 4, BO7) ? s1 : po;
    pennantCt[s1]++; pennantCt[po]++;
    champCt[champ]++;
  }

  const pct = (c: Float64Array, t: number) => Number(((100 * c[t]) / sims).toFixed(2));
  const results: TeamSimResult[] = teams.map((tm, t) => ({
    team: tm.team,
    rank: 0,
    proj_wins: Number((projWins[t] / sims).toFixed(1)),
    first: pct(firstCt, t),
    playoff: pct(playoffCt, t),
    pennant: pct(pennantCt, t),
    championship: pct(champCt, t),
    off_rating: Number(((100 * rs[t]) / lgRg).toFixed(1)),
    def_rating: Number(((100 * lgRg) / ra[t]).toFixed(1)),
    rs_per_game: Number(rs[t].toFixed(2)),
    ra_per_game: Number(ra[t].toFixed(2)),
  }));

  results.sort((a, b) => b.proj_wins - a.proj_wins || b.championship - a.championship);
  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}
