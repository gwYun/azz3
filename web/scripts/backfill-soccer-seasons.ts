/**
 * One-off backfill: land every PAST season Naver lists (European leagues:
 * 2023/24 onward) into soccer_games / soccer_standings / soccer_player_stats /
 * soccer_teams, so the match-prediction model has multi-season results to fit
 * on. The nightly cron only ever touches the current season.
 *
 * Runs the SAME ingestLeague the cron uses, with an explicit past season.
 * Idempotent (all upserts), so it's safe to re-run. Skips the current season
 * unless --include-current is passed (the cron owns that one).
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-soccer-seasons.ts                    # big-5, all past seasons
 *   npx tsx scripts/backfill-soccer-seasons.ts epl,primera 2025   # leagues + only seasons >= 2025
 *   npx tsx scripts/backfill-soccer-seasons.ts --include-current
 */
import { createAdminClient } from "../lib/supabase/admin";
import { ingestLeague } from "../lib/soccer/ingest";
import { getLeague, type LeagueDef } from "../lib/soccer/leagues";
import { listSeasons } from "../lib/soccer/naver";

const BIG5 = ["epl", "primera", "bundesliga", "seria", "ligue1"];

async function main() {
  const args = process.argv.slice(2);
  const includeCurrent = args.includes("--include-current");
  const positional = args.filter((a) => !a.startsWith("--"));
  const codes = positional[0] ? positional[0].split(",") : BIG5;
  const minYear = positional[1] ? Number(positional[1]) : 0;

  const admin = createAdminClient();
  for (const code of codes) {
    const def: LeagueDef | undefined = getLeague(code);
    if (!def) { console.error(`unknown league ${code}`); continue; }
    const seasons = (await listSeasons(def))
      .filter((s) => (includeCurrent || !s.current) && s.year >= minYear);
    for (const { current: _c, ...season } of seasons) {
      try {
        const r = await ingestLeague(admin, def, { season });
        console.log(
          `  ${code} ${season.year} (${season.seasonCode}): games=${r.gamesUpserted} ` +
          `standings=${r.standingsUpserted} players=${r.playersUpserted}`,
        );
      } catch (e) {
        console.error(`  ${code} ${season.year} FAILED:`, e instanceof Error ? e.message : e);
      }
    }
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
