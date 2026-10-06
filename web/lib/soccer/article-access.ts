/**
 * Server-side source of truth for the soccer report time-lock (sibling of
 * lib/kbo/article-access.ts): a report is paid iff it is among its team's
 * SOCCER_ARTICLE_LOCK_WINDOW newest. Computed from the DB, never the client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SOCCER_ARTICLE_LOCK_WINDOW } from "@/lib/credits";

export async function isSoccerArticleLocked(
  admin: SupabaseClient,
  league: string,
  team: string,
  date: string,
): Promise<boolean> {
  const { count } = await admin
    .from("soccer_articles")
    .select("id", { count: "exact", head: true })
    .eq("league", league)
    .eq("team", team)
    .gt("article_date", date);
  return (count ?? 0) < SOCCER_ARTICLE_LOCK_WINDOW;
}
