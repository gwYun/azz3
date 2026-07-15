// KBO 야구 승부 예측 — client-side matchup engine.
//
// The Python export (kbo/src/matchup_export.py) ships per-player event rates; the actual
// simulation runs here so the user can pick teams, edit lineups, and advance the rotation
// and re-run live. Three layers:
//   1. log5 batter×pitcher matchup → a per-PA outcome multinomial,
//   2. a base-out (24-state) Markov chain that cycles the 9-batter ORDER across innings →
//      order-sensitive expected runs μ (this is what makes a "win-max lineup" meaningful),
//   3. an exact NegBinom score convolution for win probability (the 1,000,000-draw Monte
//      Carlo in matchup.worker.ts samples the same distributions for the histogram).
//
// `markovExpectedRuns` is a line-for-line port of the Python reference
// (matchup_export.markov_expected_runs); tests/test_kbo_v2.py pins them to parity.

export type Rates = { bb: number; b1: number; b2: number; b3: number; hr: number; out: number };
export type Segment = { fip: number; rates: Rates };
export type Pitcher = Segment & { name: string; gs: number; sp_innings: number };
export type Reliever = { name: string; ip: number; fip: number; war: number; rates: Rates };
export type Batter = { name: string; pa: number; wrc_plus: number; war: number; rates: Rates };
export type Team = {
  code: string; ko: string; en: string; park: string;
  rs_per_game: number; ra_per_game: number; off_rating: number; def_rating: number;
  mu_calib: number; batters: Batter[]; lineup_projected: number[];
  rotation: Pitcher[]; bullpen_arms: Reliever[]; bullpen: Segment; bullpen_elite: Segment;
};
export type League = {
  lg_R_per_G: number; k: number; home_factor: number;
  event: Rates; hit_split_nonhr: { b1: number; b2: number; b3: number };
};
export type MatchupData = {
  version: string; season: string; method: string; league: League;
  teams: Team[]; caveat: string; run_id?: string; model_commit?: string;
};

const OUT = 5;
const PA_CAP = 150;

export function rateVec(r: Rates): number[] {
  return [r.bb, r.b1, r.b2, r.b3, r.hr, r.out];
}

// Base-out advancement table: _ADV[state][e] = {ns, runs}. Bit0=1B, 1=2B, 2=3B.
// Identical rules to the Python reference (aggressive-single baserunning, no DP/variance).
type Adv = { ns: number; runs: number };
const _ADV: Adv[][] = (() => {
  const adv: Adv[][] = [];
  for (let st = 0; st < 8; st++) {
    const r1 = st & 1, r2 = (st >> 1) & 1, r3 = (st >> 2) & 1;
    const row: Adv[] = [];
    // BB (e=0): batter to 1B, force only.
    row[0] = { ns: 1 | ((r1 ? 1 : r2) << 1) | ((r1 && r2 ? 1 : r3) << 2), runs: r1 && r2 && r3 ? 1 : 0 };
    // 1B (e=1): batter->1B, runner 1B->2B, runners on 2B/3B score.
    row[1] = { ns: 1 | (r1 << 1), runs: r2 + r3 };
    // 2B (e=2): batter->2B, runner 1B->3B, runners on 2B/3B score.
    row[2] = { ns: (1 << 1) | (r1 << 2), runs: r2 + r3 };
    // 3B (e=3): batter->3B, everyone scores.
    row[3] = { ns: 1 << 2, runs: r1 + r2 + r3 };
    // HR (e=4): batter + everyone scores.
    row[4] = { ns: 0, runs: r1 + r2 + r3 + 1 };
    adv.push(row);
  }
  return adv;
})();

// log5 / odds-ratio matchup: batter b vs pitcher p, renormalized to a valid multinomial.
export function matchupDist(b: number[], p: number[], lg: number[]): number[] {
  const raw = new Array(6);
  let s = 0;
  for (let e = 0; e < 6; e++) {
    const v = lg[e] > 0 ? (b[e] * p[e]) / lg[e] : 0;
    raw[e] = v;
    s += v;
  }
  if (s <= 0) return lg.slice();
  for (let e = 0; e < 6; e++) raw[e] /= s;
  return raw;
}

// Expected runs over 9 innings for an ordered lineup vs a starter/bullpen pair.
// Batter for the k-th plate appearance is (k mod 9) — the lineup pointer carries across
// innings, which is the source of the order effect. Deterministic; ~O(10) calls/matchup.
export function markovExpectedRuns(
  order: Rates[], sp: Rates, pen: Rates, lgEvent: Rates,
  spInnings: number, home: boolean, elite: Rates | null, calib: number, homeFactor: number,
): number {
  const lgv = rateVec(lgEvent);
  const ov = order.map(rateVec);
  const spv = rateVec(sp), penv = rateVec(pen);
  const mSp = ov.map((b) => matchupDist(b, spv, lgv));
  const mPen = ov.map((b) => matchupDist(b, penv, lgv));
  const mEl = elite ? ov.map((b) => matchupDist(b, rateVec(elite), lgv)) : null;
  const starterInnings = Math.round(Math.min(Math.max(spInnings, 4), 7));

  // P[inning][state][outs], innings 1..9 (index 0 and 10 are sinks).
  const mk = () => Array.from({ length: 11 }, () => Array.from({ length: 8 }, () => [0, 0, 0]));
  let P = mk();
  P[1][0][0] = 1.0;
  let mu = 0.0;
  for (let k = 0; k < PA_CAP; k++) {
    const b = k % 9;
    const newP = mk();
    let step = 0.0, active = 0.0;
    for (let inning = 1; inning <= 9; inning++) {
      const M = inning <= starterInnings ? mSp[b] : (mEl && inning === 9 ? mEl[b] : mPen[b]);
      for (let st = 0; st < 8; st++) {
        for (let outs = 0; outs < 3; outs++) {
          const p = P[inning][st][outs];
          if (p === 0.0) continue;
          active += p;
          for (let e = 0; e < 6; e++) {
            const pe = M[e];
            if (pe === 0.0) continue;
            const mass = p * pe;
            if (e === OUT) {
              if (outs === 2) {
                if (inning < 9) newP[inning + 1][0][0] += mass;
              } else {
                newP[inning][st][outs + 1] += mass;
              }
            } else {
              const a = _ADV[st][e];
              step += mass * a.runs;
              newP[inning][a.ns][outs] += mass;
            }
          }
        }
      }
    }
    mu += step;
    P = newP;
    if (active < 1e-9) break;
  }
  return mu * calib * (home ? homeFactor : 1.0);
}

// Negative-Binomial score PMF over 0..cap runs (mean mu, dispersion k), tail folded in.
export function negBinomPmf(mu: number, k: number, cap: number): Float64Array {
  const pmf = new Float64Array(cap + 1);
  const p = k / (k + mu);              // P(0) = p^k
  let cur = Math.pow(p, k);
  let sum = 0;
  for (let r = 0; r <= cap; r++) {
    pmf[r] = cur;
    sum += cur;
    cur = (cur * (1 - p) * (k + r)) / (r + 1);   // NB recurrence
  }
  if (sum < 1) pmf[cap] += 1 - sum;    // fold the tail into the last bin
  return pmf;
}

// Exact P(home win) from two score PMFs; ties broken by a run-rate-weighted coin flip
// (matches kbo/src/game_model.simulate_game_winner).
export function winProbExact(muHome: number, muAway: number, k: number, cap = 25): number {
  const ph = negBinomPmf(muHome, k, cap);
  const pa = negBinomPmf(muAway, k, cap);
  let win = 0, tie = 0;
  for (let rh = 0; rh <= cap; rh++) {
    for (let ra = 0; ra <= cap; ra++) {
      const m = ph[rh] * pa[ra];
      if (rh > ra) win += m;
      else if (rh === ra) tie += m;
    }
  }
  return win + tie * (muHome / (muHome + muAway));
}

// ---- lineup helpers -------------------------------------------------------- //

function orderRates(pool: Batter[], idx: number[]): Rates[] {
  return idx.map((i) => pool[i].rates);
}

/** μ for a candidate order (indices into pool) vs a fixed opponent. */
export function muForOrder(
  pool: Batter[], idx: number[], oppSp: Rates, oppPen: Rates, oppElite: Rates | null,
  spInnings: number, lg: League, home: boolean, calib: number,
): number {
  return markovExpectedRuns(orderRates(pool, idx), oppSp, oppPen, lg.event,
    spInnings, home, oppElite, calib, lg.home_factor);
}

// For a fixed opponent, P(win) is strictly increasing in the team's own μ, so the
// win-max lineup == the expected-runs-max lineup — we hill-climb on μ (fast, deterministic)
// instead of simulating each candidate. Greedy pairwise swaps + bench substitutions.
export function optimizeLineup(
  pool: Batter[], start: number[], oppSp: Rates, oppPen: Rates, oppElite: Rates | null,
  spInnings: number, lg: League, home: boolean, calib: number,
): { order: number[]; mu: number } {
  let order = start.slice(0, 9);
  const evalMu = (o: number[]) => muForOrder(pool, o, oppSp, oppPen, oppElite, spInnings, lg, home, calib);
  let best = evalMu(order);
  const eps = 1e-4;
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    // (a) swap two batting-order positions
    for (let i = 0; i < 9; i++) {
      for (let j = i + 1; j < 9; j++) {
        const cand = order.slice();
        [cand[i], cand[j]] = [cand[j], cand[i]];
        const mu = evalMu(cand);
        if (mu > best + eps) { order = cand; best = mu; improved = true; }
      }
    }
    // (b) replace a starter with a bench bat from the pool
    for (let i = 0; i < 9; i++) {
      for (let bIdx = 0; bIdx < pool.length; bIdx++) {
        if (order.includes(bIdx)) continue;
        const cand = order.slice();
        cand[i] = bIdx;
        const mu = evalMu(cand);
        if (mu > best + eps) { order = cand; best = mu; improved = true; }
      }
    }
    if (!improved) break;
  }
  return { order, mu: best };
}

// ---- rotation + bullpen availability (model-based, no per-game feed) -------- //

/** The starter for a given game in a series: advance the rotation so no back-to-back reuse. */
export function starterForGame(rotation: Pitcher[], gameIndex: number): Pitcher {
  return rotation[((gameIndex % rotation.length) + rotation.length) % rotation.length];
}

const EVKEYS = ["bb", "b1", "b2", "b3", "hr", "out"] as const;
const REL_USE_PER_GAME = 3;   // ~3 relievers cover the late innings each game

export type BullpenState = { rates: Rates; eliteRates: Rates; available: Reliever[]; down: Reliever[] };

function compositeRates(arms: Reliever[]): Rates {
  let w = 0;
  const acc: Rates = { bb: 0, b1: 0, b2: 0, b3: 0, hr: 0, out: 0 };
  for (const a of arms) {
    const ip = Math.max(a.ip, 0.1);
    w += ip;
    for (const e of EVKEYS) acc[e] += a.rates[e] * ip;
  }
  const r = {} as Rates;
  for (const e of EVKEYS) r[e] = acc[e] / (w || 1);
  return r;
}

// Model each team's available bullpen for a given game in a series. Arms are leverage-
// ranked (index 0 = closer/highest leverage); the top two need a day off after throwing.
// We forward-simulate usage across the prior games so that on game 2 the best arms are
// down and the opponent faces a weaker, recomposed bullpen — the "excluding the previous
// game's bullpen" behavior, without any per-game feed (which is robots-blocked).
export function bullpenForGame(arms: Reliever[], day: number, fallback: Segment): BullpenState {
  if (!arms.length) return { rates: fallback.rates, eliteRates: fallback.rates, available: [], down: [] };
  const rest = arms.map((_, j) => (j < 2 ? 1 : 0));
  const lastUsed = arms.map(() => -99);
  for (let d = 0; d < day; d++) {
    let used = 0;
    for (let j = 0; j < arms.length && used < REL_USE_PER_GAME; j++) {
      if (d - lastUsed[j] > rest[j]) { lastUsed[j] = d; used++; }
    }
  }
  const available: Reliever[] = [], down: Reliever[] = [];
  arms.forEach((a, j) => (day - lastUsed[j] > rest[j] ? available : down).push(a));
  const pool = available.length ? available : arms;
  return { rates: compositeRates(pool), eliteRates: pool[0].rates, available, down };
}

export type MatchupResult = {
  muHome: number; muAway: number;
  homeWin: number; awayWin: number;
  expHome: number; expAway: number;
};

/** One matchup's μ + exact win prob for chosen lineups, starters, and per-game bullpens. */
export function evaluateMatchup(
  lg: League, home: Team, away: Team, homeOrder: number[], awayOrder: number[],
  homeStarter: Pitcher, awayStarter: Pitcher, homePen: BullpenState, awayPen: BullpenState,
  useElite: boolean,
): MatchupResult {
  const muHome = muForOrder(home.batters, homeOrder, awayStarter.rates, awayPen.rates,
    useElite ? awayPen.eliteRates : null, awayStarter.sp_innings, lg, true, home.mu_calib);
  const muAway = muForOrder(away.batters, awayOrder, homeStarter.rates, homePen.rates,
    useElite ? homePen.eliteRates : null, homeStarter.sp_innings, lg, false, away.mu_calib);
  const homeWin = winProbExact(muHome, muAway, lg.k);
  return { muHome, muAway, homeWin, awayWin: 1 - homeWin, expHome: muHome, expAway: muAway };
}
