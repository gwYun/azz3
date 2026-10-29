/**
 * After a LoL model change: recompute every walk-forward reconstruction (each
 * from a fit on data strictly before its start) and re-predict upcoming series
 * with the current fit. Real pre-match predictions of started series stay frozen.
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/rebuild-lol-predictions.ts
 */
import { createAdminClient } from "../lib/supabase/admin";
import { backfillWalkForward, fitAll, loadMatches, writePredictions } from "../lib/lol/pipeline";

(async () => {
  const admin = createAdminClient();
  const now = new Date();
  const rows = await loadMatches(admin);
  const rebuilt = await backfillWalkForward(admin, rows, { rebuild: true });
  const predicted = await writePredictions(admin, rows, fitAll(rows, now.getTime()), now);
  console.log(JSON.stringify({ rebuilt, predicted }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
