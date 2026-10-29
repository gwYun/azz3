/**
 * LoL match model — map-level Bradley–Terry with region offsets.
 *
 *   P(A wins a map) = σ(r_A − r_B),   r_t = R[region(t)] + u_t
 *
 * Every finished series contributes its MAP score (a 3-1 is three A-maps and one
 * B-map), weighted by recency (half-life `halfLifeDays`). Team skill u_t has a
 * N(0, sdTeam²) prior, the region offset R a N(0, sdRegion²) prior — region
 * offsets are only identified by international series (MSI, Worlds), so the
 * prior keeps them sane early in a season. Fit = MAP via damped diagonal Newton.
 *
 * Series odds treat maps as independent draws at the same p (no side / momentum
 * effects), which gives the exact Bo1/Bo3/Bo5 win probability and score
 * distribution.
 */

export interface TrainSeries {
  t: number;          // start time, epoch ms
  home: string;       // team id
  away: string;
  homeMaps: number;
  awayMaps: number;
  intl?: boolean;     // international event (weight multiplier applies)
}

export interface ModelOptions {
  halfLifeDays: number;
  sdTeam: number;
  sdRegion: number;
  intlWeight: number;
  iterations: number;
}

// Walk-forward tuned on 2025 international series (scripts/tune-lol.ts):
// only sdRegion moved (0.6 → 0.4); Worlds 2026 was held out.
export const DEFAULT_OPTIONS: ModelOptions = {
  halfLifeDays: 240,
  sdTeam: 0.6,
  sdRegion: 0.4,
  intlWeight: 1,
  iterations: 30,
};

export interface LolFit {
  rating: Map<string, number>;        // r_t (log-odds scale), teams seen in training
  regionOffset: Map<string, number>;  // R per region
  regionOf: Map<string, string>;
  teamSkill: Map<string, number>;     // u_t
  asOf: number;
  options: ModelOptions;
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Fit ratings on series that finished before `asOf`. `regionOf` maps team → region (unknown → 'OTHER'). */
export function fitLol(
  series: TrainSeries[],
  regionOf: Map<string, string>,
  asOf: number,
  opts: Partial<ModelOptions> = {},
): LolFit {
  const o: ModelOptions = { ...DEFAULT_OPTIONS };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) (o as any)[k] = v;

  const data = series.filter((s) => s.t < asOf && s.homeMaps + s.awayMaps > 0);
  const teams = new Map<string, number>();
  const idx = (t: string) => {
    let i = teams.get(t);
    if (i === undefined) { i = teams.size; teams.set(t, i); }
    return i;
  };
  const rows = data.map((s) => ({
    h: idx(s.home),
    a: idx(s.away),
    wh: s.homeMaps,
    wa: s.awayMaps,
    w: Math.pow(0.5, (asOf - s.t) / 86_400_000 / o.halfLifeDays) * (s.intl ? o.intlWeight : 1),
  }));
  const names = [...teams.keys()];
  const regionNames = [...new Set(names.map((t) => regionOf.get(t) ?? "OTHER"))];
  const regIdx = new Map(regionNames.map((r, i) => [r, i]));
  const teamReg = names.map((t) => regIdx.get(regionOf.get(t) ?? "OTHER")!);

  // θ = [u_0..u_{T-1}, R_0..R_{G-1}]. Full Newton: the region and team terms are
  // strongly coupled (a region offset is the mean of its teams), so a diagonal
  // step oscillates; the dense solve is cheap at ~150 parameters.
  const T = names.length, G = regionNames.length, P = T + G;
  const theta = new Float64Array(P);
  const prior = new Float64Array(P);
  for (let i = 0; i < T; i++) prior[i] = 1 / (o.sdTeam * o.sdTeam);
  for (let j = 0; j < G; j++) prior[T + j] = 1 / (o.sdRegion * o.sdRegion);
  // Each row's design vector as (index, sign) pairs; same-region R terms cancel.
  const design = rows.map((r) => {
    const x: [number, number][] = [[r.h, 1], [r.a, -1]];
    if (teamReg[r.h] !== teamReg[r.a]) x.push([T + teamReg[r.h], 1], [T + teamReg[r.a], -1]);
    return x;
  });

  for (let it = 0; it < o.iterations; it++) {
    const g = new Float64Array(P);
    const H = Array.from({ length: P }, () => new Float64Array(P));
    rows.forEach((r, k) => {
      const x = design[k];
      let d = 0;
      for (const [i, s] of x) d += s * theta[i];
      const p = sigmoid(d);
      const n = r.wh + r.wa;
      const gr = r.w * (r.wh - n * p);
      const hr = r.w * n * p * (1 - p);
      for (const [i, si] of x) {
        g[i] += si * gr;
        for (const [j, sj] of x) H[i][j] += si * sj * hr;
      }
    });
    for (let i = 0; i < P; i++) {
      g[i] -= prior[i] * theta[i];
      H[i][i] += prior[i];
    }
    const step = solveSpd(H, g);
    let maxStep = 0;
    for (let i = 0; i < P; i++) {
      theta[i] += step[i];
      maxStep = Math.max(maxStep, Math.abs(step[i]));
    }
    if (maxStep < 1e-7) break;
  }
  const u = theta.subarray(0, T);
  const R = theta.subarray(T);

  const rating = new Map<string, number>();
  const teamSkill = new Map<string, number>();
  names.forEach((t, i) => {
    rating.set(t, R[teamReg[i]] + u[i]);
    teamSkill.set(t, u[i]);
  });
  const regionOffset = new Map(regionNames.map((r, j) => [r, R[j]]));
  return { rating, regionOffset, regionOf, teamSkill, asOf, options: o };
}

/** Solve H·x = g for symmetric positive-definite H (Cholesky; H is consumed). */
function solveSpd(H: Float64Array[], g: Float64Array): Float64Array {
  const n = g.length;
  for (let j = 0; j < n; j++) {
    let s = H[j][j];
    for (let k = 0; k < j; k++) s -= H[j][k] * H[j][k];
    const ljj = Math.sqrt(Math.max(s, 1e-12));
    H[j][j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let t = H[i][j];
      for (let k = 0; k < j; k++) t -= H[i][k] * H[j][k];
      H[i][j] = t / ljj;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = g[i];
    for (let k = 0; k < i; k++) s -= H[i][k] * y[k];
    y[i] = s / H[i][i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= H[k][i] * x[k];
    x[i] = s / H[i][i];
  }
  return x;
}

/** Rating for any team: fitted value, else its region's offset (unseen team = average of its region). */
export function ratingOf(fit: LolFit, team: string): number {
  return fit.rating.get(team) ?? fit.regionOffset.get(fit.regionOf.get(team) ?? "OTHER") ?? 0;
}

/** P(home wins one map). */
export function mapWinProb(fit: LolFit, home: string, away: string): number {
  return sigmoid(ratingOf(fit, home) - ratingOf(fit, away));
}

function choose(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

/**
 * Exact best-of-N distribution from a per-map p, optionally from a live score.
 * Returns P(A wins the series) and every final score { a, b, p }.
 */
export function seriesOutcomes(
  p: number,
  bestOf: number,
  from: { a: number; b: number } = { a: 0, b: 0 },
): { pA: number; scores: { a: number; b: number; p: number }[] } {
  const need = Math.ceil(bestOf / 2);
  const scores: { a: number; b: number; p: number }[] = [];
  if (from.a >= need || from.b >= need) {
    return { pA: from.a >= need ? 1 : 0, scores: [{ a: from.a, b: from.b, p: 1 }] };
  }
  const na = need - from.a, nb = need - from.b;
  let pA = 0;
  // A wins: A takes its last needed map with k of B's maps before it (k < nb).
  for (let k = 0; k < nb; k++) {
    const q = choose(na - 1 + k, k) * Math.pow(p, na) * Math.pow(1 - p, k);
    pA += q;
    scores.push({ a: need, b: from.b + k, p: q });
  }
  for (let k = 0; k < na; k++) {
    const q = choose(nb - 1 + k, k) * Math.pow(1 - p, nb) * Math.pow(p, k);
    scores.push({ a: from.a + k, b: need, p: q });
  }
  return { pA, scores };
}

/** P(home wins the series). */
export function seriesWinProb(fit: LolFit, home: string, away: string, bestOf: number): number {
  return seriesOutcomes(mapWinProb(fit, home, away), bestOf).pA;
}
