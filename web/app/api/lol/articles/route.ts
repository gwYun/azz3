import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOL_ARTICLE_LOCK_WINDOW } from "@/lib/credits";
import { WORLDS_SEASON } from "@/lib/lol/pipeline";

/**
 * Public Worlds report index — PUBLIC fields only (never body_html).
 *   GET /api/lol/articles            → every report, newest first + team list
 *   GET /api/lol/articles?team=GEN   → reports featuring that team (review or preview)
 * Cards carry team='worlds' (the reader URL segment); `clubs` feeds the hub's team filter.
 */
export const revalidate = 300;

type Row = { article_date: string; teams: string[]; title: string; dek: string; teaser: unknown; reply_count: number | null; view_count: number | null };

export async function GET(request: Request) {
  const team = new URL(request.url).searchParams.get("team");
  if (team && !/^[\w.-]{1,16}$/.test(team)) {
    return NextResponse.json({ error: "invalid team" }, { status: 400 });
  }
  const admin = createAdminClient();
  try {
    const { data, error } = await admin.from("lol_articles")
      .select("article_date, teams, title, dek, teaser, reply_count, view_count")
      .eq("season", WORLDS_SEASON).eq("event", "worlds")
      .order("article_date", { ascending: false }).limit(100);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    // Lock by global recency (the paywall is per event, not per team).
    const items = rows.map((r, i) => ({
      team: "worlds", ko: "롤드컵", article_date: r.article_date, title: r.title, dek: r.dek, teaser: r.teaser,
      locked: i < LOL_ARTICLE_LOCK_WINDOW, reply_count: r.reply_count ?? 0, view_count: r.view_count ?? 0, teams: r.teams,
    }));
    const codes = [...new Set(rows.flatMap((r) => r.teams))].sort();
    const clubs = codes.map((c) => ({ code: c, ko: c, en: c }));
    return NextResponse.json({ clubs, cards: team ? items.filter((r) => r.teams.includes(team)) : items });
  } catch (e) {
    return NextResponse.json({ clubs: [], cards: [], error: e instanceof Error ? e.message : "err" }, { status: 200 });
  }
}
