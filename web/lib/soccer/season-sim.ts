/**
 * Conditional season sim — fixes the current table and Monte-Carlos only the
 * REMAINING published fixtures with the match model's λs (Poisson goals; the
 * Dixon-Coles τ only matters for exact low scores, not the table, so it is
 * omitted here). Tiebreak: points → goal difference → goals for → random.
 *
 * "Remaining" = the fixtures Naver has published. K League 1 publishes only the
 * first 33 rounds; the post-split rounds (top 6 / bottom 6, single round-robin)
 * appear later. With `split`, each sim draw first plays the published fixtures,
 * then splits the table by that draw's standings and plays the missing group
 * games (random home side). Teams then finish inside their group: a bottom-six
 * side can't rise above 7th however many points it banks.
 */

export interface TableRow {
  team: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

export interface Fixture {
  home: string;
  away: string;
  lh: number;
  la: number;
}

export interface SimTeam {
  team: string;
  expPts: number;
  title: number; // % finishing 1st
  top: number; // % finishing within the league's top zone
  bottom: number; // % finishing within the bottom zone
  rankDist: number[]; // % per final position (index 0 = 1st)
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lam: number, rnd: () => number): number {
  const L = Math.exp(-lam);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
}

/** Current table from finished games (computed, not Naver's, so GD/GF tiebreaks are ours). */
export function buildTable(
  teams: string[],
  results: { home: string; away: string; hs: number; as: number }[],
): Map<string, TableRow> {
  const t = new Map<string, TableRow>(
    teams.map((c) => [c, { team: c, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]),
  );
  for (const r of results) {
    const h = t.get(r.home);
    const a = t.get(r.away);
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += r.hs; h.ga += r.as; a.gf += r.as; a.ga += r.hs;
    if (r.hs > r.as) { h.w++; a.l++; h.pts += 3; }
    else if (r.hs < r.as) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  return t;
}

/** Rank a table: points, GD, GF (then input order). */
export function rankTable(rows: TableRow[]): TableRow[] {
  return [...rows].sort(
    (x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf,
  );
}

export interface SplitRule {
  groupSize: number; // 6 for K League 1
  /** Expected goals for a synthesized group fixture. */
  lam: (home: string, away: string) => [number, number];
}

export function simulateSeason(
  table: Map<string, TableRow>,
  fixtures: Fixture[],
  zones: { top: number; bottom: number },
  opts: { sims?: number; seed?: number; split?: SplitRule } = {},
): Map<string, SimTeam> {
  const sims = opts.sims ?? 20000;
  const rnd = mulberry32(opts.seed ?? 42);
  const teams = [...table.keys()];
  const N = teams.length;
  const pos = new Map(teams.map((t, i) => [t, i]));
  const base = teams.map((t) => table.get(t)!);
  const rankCount = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const ptsSum = new Array<number>(N).fill(0);

  const pts = new Array<number>(N);
  const gd = new Array<number>(N);
  const gf = new Array<number>(N);
  const order = teams.map((_, i) => i);
  const jitter = new Array<number>(N);
  const split = opts.split;
  const splitLam = new Map<string, [number, number]>();
  if (split) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j) splitLam.set(`${i}|${j}`, split.lam(teams[i], teams[j]));
  }
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < N; i++) {
      pts[i] = base[i].pts;
      gd[i] = base[i].gf - base[i].ga;
      gf[i] = base[i].gf;
      jitter[i] = rnd();
    }
    for (const f of fixtures) {
      const h = pos.get(f.home);
      const a = pos.get(f.away);
      if (h == null || a == null) continue;
      const x = poisson(f.lh, rnd);
      const y = poisson(f.la, rnd);
      gd[h] += x - y; gd[a] += y - x; gf[h] += x; gf[a] += y;
      if (x > y) pts[h] += 3;
      else if (x < y) pts[a] += 3;
      else { pts[h]++; pts[a]++; }
    }
    const cmp = (i: number, j: number) => pts[j] - pts[i] || gd[j] - gd[i] || gf[j] - gf[i] || jitter[j] - jitter[i];
    order.sort(cmp);
    if (split) {
      // Split by this draw's standings, play each group's round-robin, rank within groups.
      const G = split.groupSize;
      const groups = [order.slice(0, G), order.slice(G)];
      for (const grp of groups) {
        for (let x = 0; x < grp.length; x++) {
          for (let y = x + 1; y < grp.length; y++) {
            const [h, a] = rnd() < 0.5 ? [grp[x], grp[y]] : [grp[y], grp[x]];
            const lam = splitLam.get(`${h}|${a}`)!;
            const gh = poisson(lam[0], rnd), ga = poisson(lam[1], rnd);
            gd[h] += gh - ga; gd[a] += ga - gh; gf[h] += gh; gf[a] += ga;
            if (gh > ga) pts[h] += 3; else if (gh < ga) pts[a] += 3; else { pts[h]++; pts[a]++; }
          }
        }
        grp.sort(cmp);
      }
      order.splice(0, N, ...groups[0], ...groups[1]);
    }
    for (let r = 0; r < N; r++) rankCount[order[r]][r]++;
    for (let i = 0; i < N; i++) ptsSum[i] += pts[i];
  }

  const out = new Map<string, SimTeam>();
  const pct = (c: number) => Number(((100 * c) / sims).toFixed(1));
  teams.forEach((t, i) => {
    const dist = rankCount[i];
    out.set(t, {
      team: t,
      expPts: Number((ptsSum[i] / sims).toFixed(1)),
      title: pct(dist[0]),
      top: pct(dist.slice(0, zones.top).reduce((a, b) => a + b, 0)),
      bottom: pct(dist.slice(N - zones.bottom).reduce((a, b) => a + b, 0)),
      rankDist: dist.map(pct),
    });
  });
  return out;
}
