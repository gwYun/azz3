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

/**
 * The set of `${team}|${date}` keys that are locked (each team's newest
 * ARTICLE_LOCK_WINDOW), across the given teams. Lets a multi-article response
 * label `locked` correctly in ONE query, instead of a per-row count — needed
 * once a list spans several teams or a date range, where a row's index is no
 * longer its rank within its own team.
 */
export async function lockedDateSet(
  admin: SupabaseClient,
  season: number,
  teams: string[],
): Promise<Set<string>> {
  const locked = new Set<string>();
  if (teams.length === 0) return locked;

  const { data } = await admin
    .from("kbo_articles")
    .select("team, article_date")
    .eq("season", season)
    .in("team", teams)
    .order("team", { ascending: true })
    .order("article_date", { ascending: false });

  const seen = new Map<string, number>();
  for (const r of (data ?? []) as { team: string; article_date: string }[]) {
    const n = seen.get(r.team) ?? 0;
    if (n < ARTICLE_LOCK_WINDOW) {
      locked.add(`${r.team}|${r.article_date}`);
      seen.set(r.team, n + 1);
    }
  }
  return locked;
}
