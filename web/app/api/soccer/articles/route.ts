import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLeague } from "@/lib/soccer/leagues";
import { SOCCER_ARTICLE_LOCK_WINDOW } from "@/lib/credits";

/**
 * Public soccer report index — PUBLIC fields only, never body_html (that's the
 * gated route). `locked` is by age, so this is cacheable.
 *
 *   GET /api/soccer/articles?league=epl            → latest report per team + club list
 *   GET /api/soccer/articles?league=epl&team=12    → that team's archive, newest first
 */
export const revalidate = 300;

type Row = { team: string; article_date: string; title: string; dek: string; teaser: unknown };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") ?? "";
  const team = params.get("team");
  if (!getLeague(league)) {
    return NextResponse.json({ error: "invalid league" }, { status: 400 });
  }
  const admin = createAdminClient();

  try {
    // Club list for the filter: the teams of the league's latest season.
    const { data: snap } = await admin.from("soccer_sim_snapshots").select("payload")
      .eq("league", league).eq("kind", "season").order("season", { ascending: false }).limit(1).maybeSingle();
    const snapTeams = ((snap?.payload as { teams?: { team: string; name: string; rank: number }[] } | null)?.teams ?? []);
    const { data: teamRows } = await admin.from("soccer_teams").select("team_code, name, short_name").eq("league", league);
    const fullName = new Map((teamRows ?? []).map((t) => [t.team_code as string, (t.short_name ?? t.name) as string]));
    const nameOf = (code: string) => snapTeams.find((t) => t.team === code)?.name ?? fullName.get(code) ?? code;
    const clubs = snapTeams.map((t) => ({ code: t.team, ko: t.name, en: t.name }));

    const card = (r: Row, locked: boolean) => ({
      team: r.team, ko: nameOf(r.team), article_date: r.article_date, title: r.title, dek: r.dek, teaser: r.teaser, locked,
    });

    if (team) {
      const { data, error } = await admin.from("soccer_articles")
        .select("team, article_date, title, dek, teaser")
        .eq("league", league).eq("team", team)
        .order("article_date", { ascending: false }).limit(60);
      if (error) throw error;
      const items = ((data ?? []) as Row[]).map((r, i) => card(r, i < SOCCER_ARTICLE_LOCK_WINDOW));
      return NextResponse.json({ league, team, clubs, items });
    }

    const { data, error } = await admin.from("soccer_articles")
      .select("team, article_date, title, dek, teaser")
      .eq("league", league)
      .order("article_date", { ascending: false }).limit(300);
    if (error) throw error;
    const latest = new Map<string, Row>();
    for (const r of (data ?? []) as Row[]) if (!latest.has(r.team)) latest.set(r.team, r);
    // A team's newest report is always inside the lock window → locked.
    const cards = [...latest.values()]
      .sort((a, b) => b.article_date.localeCompare(a.article_date))
      .map((r) => card(r, true));
    return NextResponse.json({ league, clubs, cards });
  } catch (e) {
    return NextResponse.json(
      { league, clubs: [], cards: [], items: [], error: e instanceof Error ? e.message : "err" },
      { status: 200 },
    );
  }
}
