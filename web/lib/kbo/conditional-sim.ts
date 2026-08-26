/**
 * Conditional playoff-odds sim — the number that actually answers "will they
 * make 가을야구?". Unlike simulateSeason (the "0-0 restart" power sim in
 * season-sim.ts, which ignores the current standings), this FIXES each team's
 * banked W/L and Monte-Carlos only the REMAINING schedule, reconstructed as a
 * balanced round-robin (8 home / 8 away per pair; PROJECT_KNOWLEDGE §7). One run
 * yields every team's conditional top-5 odds, so the daily cron calls it once.
 *
 * Reuses the exact game model the rest of the project uses: expectedRuns() +
 * the NegBinom PMF (matchup-sim.ts). Rates passed in are ALREADY shrunk (they
 * come from the season snapshot), so we do not shrink again.
 */
import { negBinomPmf } from "../matchup-sim";
import { expectedRuns, DISPERSION_K } from "./season-sim";

export interface CondTeam {
  team: string;
  wins: number;
  losses: number;
  rsRate: number; // shrunk runs scored / game
  raRate: number; // shrunk runs allowed / game
}

export interface CondResult {
  playoff: number; // % top-5 (가을야구), current standings fixed
  first: number; // % finishing 1st
  projWins: number; // mean final wins
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** {pHome, pTie, pAway} for one game (home team listed first). */
function regularProbs(muHome: number, muAway: number, k: number, cap = 25) {
  const ph = negBinomPmf(muHome, k, cap);
  const pa = negBinomPmf(muAway, k, cap);
  let home = 0,
    tie = 0;
  for (let rh = 0; rh <= cap; rh++) {
    for (let ra = 0; ra <= cap; ra++) {
      const m = ph[rh] * pa[ra];
      if (rh > ra) home += m;
      else if (rh === ra) tie += m;
    }
  }
  return { pHome: home, pTie: tie };
}

/**
 * @param teams        current standings + shrunk rates, one per franchise.
 * @param remainingHome remainingHome[i][j] = games left with team i hosting j.
 */
export function simulateRemaining(
  teams: CondTeam[],
  remainingHome: number[][],
  opts: { sims?: number; seed?: number } = {},
): Map<string, CondResult> {
  const n = teams.length;
  const sims = opts.sims ?? 40000;
  const rand = mulberry32(opts.seed ?? 42);

  const rs = teams.map((t) => t.rsRate);
  const ra = teams.map((t) => t.raRate);
  const lgRg = (rs.reduce((a, b) => a + b, 0) + ra.reduce((a, b) => a + b, 0)) / (2 * n);

  // Precompute per-ordered-pair (i home) win/lose thresholds once.
  const winThr: number[][] = [];
  const loseThr: number[][] = [];
  for (let i = 0; i < n; i++) {
    winThr[i] = [];
    loseThr[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        winThr[i][j] = 0;
        loseThr[i][j] = 0;
        continue;
      }
      const muH = expectedRuns(rs[i], ra[j], lgRg, true);
      const muA = expectedRuns(rs[j], ra[i], lgRg, false);
      const { pHome, pTie } = regularProbs(muH, muA, DISPERSION_K);
      winThr[i][j] = pHome; // r < pHome → home (i) wins
      loseThr[i][j] = pHome + (1 - pHome - pTie); // pHome + pAway → below = decisive
    }
  }

  const playoffCt = new Float64Array(n);
  const firstCt = new Float64Array(n);
  const winSum = new Float64Array(n);
  const W = new Int32Array(n);
  const L = new Int32Array(n);
  const order = Array.from({ length: n }, (_, i) => i);

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) {
      W[i] = teams[i].wins;
      L[i] = teams[i].losses;
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const g = remainingHome[i][j];
        if (!g) continue;
        const wt = winThr[i][j];
        const lt = loseThr[i][j];
        for (let k = 0; k < g; k++) {
          const r = rand();
          if (r < wt) {
            W[i]++;
            L[j]++;
          } else if (r < lt) {
            L[i]++;
            W[j]++;
          }
          // else tie — no change
        }
      }
    }

    order.sort((x, y) => {
      const wx = W[x] / (W[x] + L[x] || 1);
      const wy = W[y] / (W[y] + L[y] || 1);
      return wy - wx || W[y] - W[x] || x - y;
    });
    for (let r = 0; r < n; r++) {
      const t = order[r];
      winSum[t] += W[t];
      if (r === 0) firstCt[t]++;
      if (r < 5) playoffCt[t]++;
    }
  }

  const out = new Map<string, CondResult>();
  for (let t = 0; t < n; t++) {
    out.set(teams[t].team, {
      playoff: Number(((100 * playoffCt[t]) / sims).toFixed(2)),
      first: Number(((100 * firstCt[t]) / sims).toFixed(2)),
      projWins: Number((winSum[t] / sims).toFixed(1)),
    });
  }
  return out;
}
