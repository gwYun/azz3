/**
 * One-time history load for the LoL rating model: every league in
 * lib/lol/leagues.ts, Jan 2024 → next month, into lol_matches. Then walk-forward
 * predictions for Worlds series already played before launch (labelled as such
 * in reports). Idempotent.
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-lol.ts [fromMonth=2024-01]
 */
import { createAdminClient } from "../lib/supabase/admin";
import { LOL_LEAGUES } from "../lib/lol/leagues";
import { fetchMonths, monthRange } from "../lib/lol/naver";
import { backfillWalkForward, loadMatches, upsertMatches } from "../lib/lol/pipeline";

(async () => {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  const months = monthRange(process.argv[2] ?? "2024-01", to);
  const matches = await fetchMonths(LOL_LEAGUES.map((l) => l.id), months);
  console.log(`fetched ${matches.length} series over ${months.length} months`);
  const admin = createAdminClient();
  console.log(`upserted ${await upsertMatches(admin, matches)}`);
  console.log(`walk-forward predictions ${await backfillWalkForward(admin, await loadMatches(admin))}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
