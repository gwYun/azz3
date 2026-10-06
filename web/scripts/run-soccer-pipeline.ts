/**
 * Run the soccer prediction + report pipeline locally, exactly as the crons do
 * (useful for the first run after applying the migration, or a manual re-run).
 *
 *   predictions  → runDailyPredictions (freeze pre-kickoff 1X2, refresh season sim)
 *   articles     → generateSoccerArticles (one report per team, day after its match)
 *
 * Writes to the Supabase project in .env.local. Article prose uses the AI
 * Gateway when AI_GATEWAY_API_KEY is set (≈ $0.008–0.013 per report), else the
 * deterministic template.
 *
 * Usage (from web/):
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/run-soccer-pipeline.ts                 # predictions + articles, all leagues
 *   npx tsx scripts/run-soccer-pipeline.ts predictions epl,kleague
 *   npx tsx scripts/run-soccer-pipeline.ts articles
 */
import { createAdminClient } from "../lib/supabase/admin";
import { runDailyPredictions } from "../lib/soccer/predictions";
import { generateSoccerArticles } from "../lib/soccer/articles";

async function main() {
  const step = process.argv[2] ?? "all";
  const leagues = process.argv[3]?.split(",");
  const admin = createAdminClient();
  if (step === "all" || step === "predictions") {
    console.log("predictions:", JSON.stringify(await runDailyPredictions(admin, { leagues }), null, 1));
  }
  if (step === "all" || step === "articles") {
    console.log("articles:", JSON.stringify(await generateSoccerArticles(admin, { leagues, budgetMs: 15 * 60_000, runId: "manual" }), null, 1));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
