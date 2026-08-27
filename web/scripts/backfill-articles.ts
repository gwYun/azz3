/**
 * One-off backfill: generate the last N days of KBO daily articles into the DB.
 * Idempotent (upsert on season+team+date), so it's safe to re-run — e.g. again
 * after setting AI_GATEWAY_API_KEY to upgrade the prose from template to Haiku.
 *
 * Runs the SAME generateDailyArticles the cron uses, once per day, oldest→newest
 * so each day's day-over-day trend reads the previous day's just-written article.
 * Standings/odds are computed as-of each morning (games before that date only).
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-articles.ts [days]      # default 7
 */
import { createAdminClient } from "../lib/supabase/admin";
import { generateDailyArticles } from "../lib/kbo/articles";

const SEASON = 2026;
const DAYS = Math.max(1, Number(process.argv[2] ?? 7));

/** KST calendar date, offsetDays from today. */
function kstDate(offsetDays: number): string {
  const ms = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
  const admin = createAdminClient();
  const dates: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) dates.push(kstDate(-i)); // oldest → newest
  console.log(`Backfilling ${dates.length} day(s): ${dates[0]} → ${dates[dates.length - 1]}\n`);

  for (const d of dates) {
    const now = new Date(`${d}T05:00:00+09:00`); // 05:00 KST on that day
    const res = await generateDailyArticles(admin, SEASON, { runId: `backfill-${d}`, now });
    console.log(`  ${d}: upserted ${res.articlesUpserted}  models=${JSON.stringify(res.models)}`);
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
