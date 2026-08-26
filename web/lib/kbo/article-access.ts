/**
 * Server-side source of truth for the article time-lock. Both the unlock route
 * and the gated body route call this so "locked" means exactly one thing: the
 * article is among its team's ARTICLE_LOCK_WINDOW most-recent. Computed from the
 * DB (not the client) so it can't be spoofed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTICLE_LOCK_WINDOW } from "@/lib/credits";

/** Count of the team's articles strictly newer than `date` (0 ⇒ it's the latest). */
export async function newerArticleCount(
  admin: SupabaseClient,
  team: string,
  date: string,
): Promise<number> {
  const { count } = await admin
    .from("kbo_articles")
    .select("id", { count: "exact", head: true })
    .eq("team", team)
    .gt("article_date", date);
  return count ?? 0;
}

/** True if the article is paywalled by recency (within the newest window). */
export async function isArticleLocked(
  admin: SupabaseClient,
  team: string,
  date: string,
): Promise<boolean> {
  return (await newerArticleCount(admin, team, date)) < ARTICLE_LOCK_WINDOW;
}
