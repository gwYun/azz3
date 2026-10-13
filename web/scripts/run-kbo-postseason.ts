/**
 * Run the KBO postseason report step locally, exactly as the 05:00 KST
 * kbo-daily cron does: round previews (morning before a round's first game) +
 * per-series game-day reports. Idempotent (upsert on season+round+date).
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/run-kbo-postseason.ts
 */
import { createAdminClient } from "../lib/supabase/admin";
import { CURRENT_SEASON } from "../lib/kbo/ingest";
import { generatePostseasonArticles } from "../lib/kbo/postseason-articles";

generatePostseasonArticles(createAdminClient(), CURRENT_SEASON, { runId: "manual" })
  .then((r) => console.log(JSON.stringify(r, null, 1)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
