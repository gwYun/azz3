import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISES, TEAM_NAMES, type Franchise } from "@/lib/kbo/franchise";
import { ARTICLE_LOCK_WINDOW } from "@/lib/credits";

/**
 * Public article index. PUBLIC fields only — never body_html (that's the gated
 * route). `locked` is by age (same for everyone), so this is cacheable; whether
 * the current user OWNS a locked one is decided client-side via useAccount.
 *
 *   GET /api/kbo/articles            → latest article per team (front page cards)
 *   GET /api/kbo/articles?team=HH    → that team's archive, newest first
 */
export const revalidate = 300;

const SEASON = 2026;
const isFranchise = (c: string | null): c is Franchise =>
  !!c && (FRANCHISES as readonly string[]).includes(c);

type Row = {
  team: string;
  article_date: string;
  title: string;
  dek: string;
  teaser: unknown;
};

const withKo = (r: Row, locked: boolean) => ({
  team: r.team,
  ko: TEAM_NAMES[r.team as Franchise]?.ko ?? r.team,
  article_date: r.article_date,
  title: r.title,
  dek: r.dek,
  teaser: r.teaser,
  locked,
});

export async function GET(request: Request) {
  const team = new URL(request.url).searchParams.get("team");
  const admin = createAdminClient();

  try {
    if (team) {
      if (!isFranchise(team)) {
        return NextResponse.json({ error: "invalid team" }, { status: 400 });
      }
      const { data, error } = await admin
        .from("kbo_articles")
        .select("team, article_date, title, dek, teaser")
        .eq("season", SEASON)
        .eq("team", team)
        .order("article_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      const items = (data ?? []).map((r, i) => withKo(r as Row, i < ARTICLE_LOCK_WINDOW));
      return NextResponse.json({ team, ko: TEAM_NAMES[team].ko, items });
    }

    // Front page: latest article per team. Pull recent rows, keep the newest per team.
    const { data, error } = await admin
      .from("kbo_articles")
      .select("team, article_date, title, dek, teaser")
      .eq("season", SEASON)
      .order("article_date", { ascending: false })
      .limit(200);
    if (error) throw error;

    const latest = new Map<string, Row>();
    for (const r of (data ?? []) as Row[]) if (!latest.has(r.team)) latest.set(r.team, r);
    // Its team's newest → always within the lock window → locked.
    const cards = FRANCHISES.filter((c) => latest.has(c)).map((c) => withKo(latest.get(c)!, true));
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json(
      { cards: [], items: [], error: e instanceof Error ? e.message : "err" },
      { status: 200 },
    );
  }
}
