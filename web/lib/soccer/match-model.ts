/**
 * Soccer match model — TypeScript port of python/soccer/apps/league_predict/
 * match_model.py, so the daily cron can refit without Python.
 *
 *   log λ_home = μ + h + att_H − def_A        att_i = β_a · r_i + u_i
 *   log λ_away = μ     + att_A − def_H        def_i = β_d · r_i + v_i
 *
 * r_i = the club's pre-season VALUE rating for the game's season
 * (soccer_club_ratings, from the Python value chain). Variants:
 *   hybrid  — β fitted + ridge-shrunk residuals u, v (big-5; value is the prior)
 *   results — β = 0, plain Dixon-Coles strengths (K League: no value data)
 *
 * Fit = time-decayed Poisson likelihood (w = e^(−ξ·days)), solved with damped
 * Newton (the objective is convex; ≤ ~70 parameters, so a dense Hessian is
 * trivial). Dixon-Coles ρ is then picked by grid on the low-score cells.
 *
 * Settings per variant were chosen by the Python walk-forward backtest on
 * 2024/25 only (holdout RPS: hybrid 0.2025, results 0.2030, base-rate 0.2296).
 */

export type ModelKind = "hybrid" | "results";

export const MODEL_SETTINGS: Record<ModelKind, { xi: number; pen: number }> = {
  hybrid: { xi: 0.004, pen: 8 },
  results: { xi: 0.002, pen: 2 },
};

export const MAX_GOALS = 10;

export interface TrainGame {
  home: string;
  away: string;
  hs: number;
  as: number;
  date: string; // YYYY-MM-DD
  rHome: number;
  rAway: number;
}

export interface FitResult {
  kind: ModelKind;
  teams: string[];
  mu: number;
  home: number;
  betaA: number;
  betaD: number;
  u: number[];
  v: number[];
  rho: number;
  nGames: number;
}

const DAY_MS = 86_400_000;

/** Solve A x = b for symmetric positive-definite A (Cholesky). A is n×n row-major. */
function choleskySolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i][j] = s / L[j][j];
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/** Dixon-Coles low-score correction τ(x, y). */
export function tau(x: number, y: number, lh: number, la: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Fit the model on finished games before `asof` (YYYY-MM-DD).
 * `xi`/`pen` default to the backtested settings for `kind`.
 */
export function fitModel(
  games: TrainGame[],
  kind: ModelKind,
  asof: string,
  opts: { xi?: number; pen?: number; maxIter?: number } = {},
): FitResult {
  const { xi, pen } = { ...MODEL_SETTINGS[kind], ...opts };
  const teams = [...new Set(games.flatMap((g) => [g.home, g.away]))].sort();
  const idx = new Map(teams.map((t, i) => [t, i]));
  const T = teams.length;
  const useBeta = kind === "hybrid";
  const off = useBeta ? 4 : 2; // first residual index
  const n = off + 2 * T;
  const asofMs = Date.parse(`${asof}T00:00:00Z`);

  // Each game = two Poisson observations with sparse design rows.
  type Obs = { cols: number[]; vals: number[]; y: number; w: number };
  const obs: Obs[] = [];
  for (const g of games) {
    const w = Math.exp((-xi * (asofMs - Date.parse(`${g.date}T00:00:00Z`))) / DAY_MS);
    const h = idx.get(g.home)!;
    const a = idx.get(g.away)!;
    const hc = [0, 1], hv = [1, 1];
    const ac = [0], av = [1];
    if (useBeta) {
      hc.push(2, 3); hv.push(g.rHome, -g.rAway);
      ac.push(2, 3); av.push(g.rAway, -g.rHome);
    }
    hc.push(off + h, off + T + a); hv.push(1, -1);
    ac.push(off + a, off + T + h); av.push(1, -1);
    obs.push({ cols: hc, vals: hv, y: g.hs, w });
    obs.push({ cols: ac, vals: av, y: g.as, w });
  }

  const ridge = (i: number) => (i >= off ? pen : 1e-6);
  const objective = (th: number[]) => {
    let f = 0;
    for (const o of obs) {
      let eta = 0;
      for (let k = 0; k < o.cols.length; k++) eta += th[o.cols[k]] * o.vals[k];
      f += o.w * (Math.exp(eta) - o.y * eta);
    }
    for (let i = 0; i < n; i++) f += ridge(i) * th[i] * th[i];
    return f;
  };

  const th = new Array<number>(n).fill(0);
  const sw = obs.reduce((s, o) => s + o.w, 0);
  const sy = obs.reduce((s, o) => s + o.w * o.y, 0);
  th[0] = Math.log(Math.max(sy / Math.max(sw, 1e-9), 0.1));

  let f = objective(th);
  for (let iter = 0; iter < (opts.maxIter ?? 50); iter++) {
    const g = new Array<number>(n).fill(0);
    const H = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const o of obs) {
      let eta = 0;
      for (let k = 0; k < o.cols.length; k++) eta += th[o.cols[k]] * o.vals[k];
      const lam = Math.exp(eta);
      const r = o.w * (lam - o.y);
      const c = o.w * lam;
      for (let k = 0; k < o.cols.length; k++) {
        g[o.cols[k]] += r * o.vals[k];
        for (let l = 0; l < o.cols.length; l++) H[o.cols[k]][o.cols[l]] += c * o.vals[k] * o.vals[l];
      }
    }
    for (let i = 0; i < n; i++) {
      g[i] += 2 * ridge(i) * th[i];
      H[i][i] += 2 * ridge(i);
    }
    const step = choleskySolve(H, g);
    let t = 1;
    let next = th.map((x, i) => x - t * step[i]);
    let fn = objective(next);
    while (fn > f && t > 1e-4) {
      t /= 2;
      next = th.map((x, i) => x - t * step[i]);
      fn = objective(next);
    }
    const gnorm = Math.sqrt(g.reduce((s, x) => s + x * x, 0));
    for (let i = 0; i < n; i++) th[i] = next[i];
    const done = Math.abs(f - fn) < 1e-9 * Math.max(1, Math.abs(f)) || gnorm < 1e-7;
    f = fn;
    if (done) break;
  }

  const fit: FitResult = {
    kind,
    teams,
    mu: th[0],
    home: th[1],
    betaA: useBeta ? th[2] : 0,
    betaD: useBeta ? th[3] : 0,
    u: th.slice(off, off + T),
    v: th.slice(off + T, off + 2 * T),
    rho: 0,
    nGames: games.length,
  };

  // ρ by grid on the low-score cells (weighted log τ), λ held at the fit.
  let best = -Infinity;
  for (let k = 0; k <= 40; k++) {
    const rho = -0.25 + k * 0.01;
    let ll = 0;
    let ok = true;
    for (let i = 0; i < games.length; i++) {
      const gm = games[i];
      if (gm.hs > 1 || gm.as > 1) continue;
      const [lh, la] = lambdas(fit, gm.home, gm.away, gm.rHome, gm.rAway);
      const tv = tau(gm.hs, gm.as, lh, la, rho);
      if (tv <= 0) { ok = false; break; }
      ll += obs[2 * i].w * Math.log(tv);
    }
    if (ok && ll > best) {
      best = ll;
      fit.rho = rho;
    }
  }
  return fit;
}

/** Expected goals for a fixture. Unseen teams (e.g. promoted) get residual 0. */
export function lambdas(
  fit: FitResult,
  home: string,
  away: string,
  rHome: number,
  rAway: number,
): [number, number] {
  const ih = fit.teams.indexOf(home);
  const ia = fit.teams.indexOf(away);
  const uh = ih >= 0 ? fit.u[ih] : 0, vh = ih >= 0 ? fit.v[ih] : 0;
  const ua = ia >= 0 ? fit.u[ia] : 0, va = ia >= 0 ? fit.v[ia] : 0;
  const attH = fit.betaA * rHome + uh, attA = fit.betaA * rAway + ua;
  const defH = fit.betaD * rHome + vh, defA = fit.betaD * rAway + va;
  return [Math.exp(fit.mu + fit.home + attH - defA), Math.exp(fit.mu + attA - defH)];
}

function poissonPmf(lam: number): number[] {
  const out = new Array<number>(MAX_GOALS + 1);
  let p = Math.exp(-lam);
  for (let k = 0; k <= MAX_GOALS; k++) {
    out[k] = p;
    p *= lam / (k + 1);
  }
  return out;
}

export interface MatchProbs {
  pHome: number;
  pDraw: number;
  pAway: number;
  topScore: string; // most likely scoreline "h-a"
}

/** 1X2 probabilities + modal scoreline from λs with the Dixon-Coles τ. */
export function outcomeProbs(lh: number, la: number, rho: number): MatchProbs {
  const ph = poissonPmf(lh);
  const pa = poissonPmf(la);
  let total = 0, pH = 0, pD = 0, pA = 0, best = -1, topScore = "0-0";
  for (let x = 0; x <= MAX_GOALS; x++) {
    for (let y = 0; y <= MAX_GOALS; y++) {
      const p = ph[x] * pa[y] * tau(x, y, lh, la, rho);
      total += p;
      if (x > y) pH += p;
      else if (x === y) pD += p;
      else pA += p;
      if (p > best) {
        best = p;
        topScore = `${x}-${y}`;
      }
    }
  }
  return { pHome: pH / total, pDraw: pD / total, pAway: pA / total, topScore };
}
