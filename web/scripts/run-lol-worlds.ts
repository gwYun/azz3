/**
 * Run the Worlds pipeline locally, exactly as /api/cron/lol-worlds does:
 * ingest recent months → refit → re-predict upcoming series → match-day report.
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/run-lol-worlds.ts [--force]
 */
import { createAdminClient } from "../lib/supabase/admin";
import { fitAll, ingestRecent, loadMatches, writePredictions } from "../lib/lol/pipeline";
import { generateLolArticle } from "../lib/lol/articles";

(async () => {
  const admin = createAdminClient();
  const now = new Date();
  const ingested = await ingestRecent(admin, now);
  const rows = await loadMatches(admin);
  const fit = fitAll(rows, now.getTime());
  const predicted = await writePredictions(admin, rows, fit, now);
  const report = await generateLolArticle(admin, rows, fit, { now, force: process.argv.includes("--force"), runId: "manual" });
  console.log(JSON.stringify({ ingested, predicted, report }, null, 1));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
