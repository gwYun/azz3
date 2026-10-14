import { handleSoccerDaily } from "@/lib/soccer/cron-handler";

/**
 * Nightly soccer refresh — triggered by Vercel Cron (see web/vercel.json).
 * Sibling of /api/cron/kbo-daily.
 *
 * Pulls robots-clean Naver Sports football feeds (games, standings, player
 * stats) for the major leagues and writes them to Supabase so the site updates
 * without a redeploy.
 *
 * Cron runs it as two groups (web/vercel.json → /api/cron/soccer-daily/[group]):
 * big5 at 03:30, rest (K League + UEFA competitions) at 03:45 UTC — one call for
 * all leagues would exceed the 300 s budget. This bare path runs everything
 * (or `?leagues=`) for manual use.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations;
 * the same header works for a manual trigger (curl with the secret). Query
 * params `?leagues=epl,primera`, `?withPlayers=0` and `?predict=0` scope a
 * manual run. After ingest it refits the match model, freezes pre-kickoff
 * predictions, and refreshes the season sim (lib/soccer/predictions.ts); the
 * match reports run separately in /api/cron/soccer-articles.
 *
 * Node runtime + long budget: fetching 7 leagues' full schedules + paginated
 * player feeds takes a while. maxDuration is honored on Fluid-compute plans.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleSoccerDaily(request);
}
