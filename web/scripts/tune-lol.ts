/**
 * Walk-forward tuning of the LoL rating model's hyperparameters.
 *
 * Every international series (MSI, EWC, Worlds) BEFORE Worlds 2026 is predicted
 * from a fit on data strictly before its KST match day, and scored by series log
 * loss / Brier / accuracy. Worlds 2026 itself is held out so the tuned model's
 * reported track record is not fitted to the games it reports on.
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/tune-lol.ts
 */
import { createAdminClient } from "../lib/supabase/admin";
import { loadMatches, WORLDS_LEAGUE_ID } from "../lib/lol/pipeline";
import { buildRegionMap, isFinished, toTrainSeries, type LolMatchRow } from "../lib/lol/data";
import { LOL_LEAGUES } from "../lib/lol/leagues";
import { fitLol, mapWinProb, seriesOutcomes, type ModelOptions } from "../lib/lol/model";

const INTL = new Set(LOL_LEAGUES.filter((l) => !l.region).map((l) => l.id));
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);

function evaluate(rows: LolMatchRow[], targets: LolMatchRow[], opts: Partial<ModelOptions>) {
  const train = toTrainSeries(rows);
  const byDay = new Map<string, LolMatchRow[]>();
  for (const m of targets) byDay.set(kstDay(m.start_at), [...(byDay.get(kstDay(m.start_at)) ?? []), m]);
  let n = 0, ll = 0, br = 0, hit = 0;
  for (const day of byDay.values()) {
    const asOf = Math.min(...day.map((m) => Date.parse(m.start_at)));
    const fit = fitLol(train, buildRegionMap(rows, asOf), asOf, opts);
    for (const m of day) {
      const p = seriesOutcomes(mapWinProb(fit, m.home_team, m.away_team), m.best_of).pA;
      const y = m.home_score > m.away_score ? 1 : 0;
      const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
      n++; ll -= y ? Math.log(q) : Math.log(1 - q); br += (p - y) ** 2; hit += (p >= 0.5 ? 1 : 0) === y ? 1 : 0;
    }
  }
  return { n, ll: ll / n, brier: br / n, acc: hit / n };
}

(async () => {
  const rows = await loadMatches(createAdminClient());
  const finished = rows.filter((m) => isFinished(m) && m.home_team !== "TBD" && m.away_team !== "TBD");
  const targets = finished.filter((m) => INTL.has(m.top_league) && m.league_id !== WORLDS_LEAGUE_ID
    && Date.parse(m.start_at) >= Date.parse("2025-01-01"));
  const holdout = finished.filter((m) => m.league_id === WORLDS_LEAGUE_ID);
  console.log(`tuning on ${targets.length} intl series (2025–), holdout Worlds 2026: ${holdout.length}`);

  const grid: Partial<ModelOptions>[] = [];
  for (const halfLifeDays of [60, 120, 240])
    for (const sdTeam of [0.3, 0.45, 0.6])
      for (const sdRegion of [0.2, 0.4, 0.6])
        for (const intlWeight of [1, 3])
          grid.push({ halfLifeDays, sdTeam, sdRegion, intlWeight });

  const res = grid.map((o) => ({ o, ...evaluate(rows, targets, o) })).sort((a, b) => a.ll - b.ll);
  for (const r of res.slice(0, 10)) console.log(JSON.stringify(r.o), r.ll.toFixed(4), r.brier.toFixed(4), r.acc.toFixed(3));
  const base = evaluate(rows, targets, {});
  console.log("default", base.ll.toFixed(4), base.brier.toFixed(4), base.acc.toFixed(3));
  const best = res[0].o;
  for (const [k, o] of [["default", {}], ["best", best]] as const) {
    const h = evaluate(rows, holdout, o);
    console.log(`holdout ${k}`, h.n, h.ll.toFixed(4), h.brier.toFixed(4), h.acc.toFixed(3));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
