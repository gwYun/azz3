/**
 * Favorites feed — which public list endpoint serves a report-hub league, and
 * where a card links. Shared by /reports/favorites; mirrors the per-league
 * wiring in app/reports/[league]/page.tsx.
 */
import type { NewsLeague } from "@/lib/news/leagues";

/** List URL for a league feed, or one team's archive when `team` is given. */
export function feedUrl(league: NewsLeague, team?: string): string | null {
  if (!league.live) return null;
  const q = (k: string, v?: string) => (v ? `${k}=${encodeURIComponent(v)}` : "");
  if (league.lol) return `/api/lol/articles${team ? `?${q("team", team)}` : ""}`;
  if (league.postseason) return `/api/kbo/postseason/articles${team ? `?${q("round", team)}` : ""}`;
  if (league.soccer) return `/api/soccer/articles?league=${league.id}${team ? `&${q("team", team)}` : ""}`;
  if (league.id === "kbo") return `/api/kbo/articles${team ? `?${q("team", team)}` : ""}`;
  return null;
}

/** Reader URL for a card of this league. */
export function cardHref(league: NewsLeague, team: string, date: string): string {
  return league.id === "kbo" ? `/kbo/news/${team}/${date}` : `/reports/${league.id}/${team}/${date}`;
}
