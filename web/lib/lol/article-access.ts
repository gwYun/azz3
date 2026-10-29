/**
 * Worlds report time-lock: the newest LOL_ARTICLE_LOCK_WINDOW reports are paid.
 * Computed from the DB so "locked" can't be spoofed (same contract as the KBO /
 * soccer article-access helpers).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOL_ARTICLE_LOCK_WINDOW } from "@/lib/credits";

export async function isLolArticleLocked(
  admin: SupabaseClient,
  season: number,
  date: string,
): Promise<boolean> {
  const { count } = await admin
    .from("lol_articles")
    .select("id", { count: "exact", head: true })
    .eq("season", season)
    .eq("event", "worlds")
    .gt("article_date", date);
  return (count ?? 0) < LOL_ARTICLE_LOCK_WINDOW;
}
