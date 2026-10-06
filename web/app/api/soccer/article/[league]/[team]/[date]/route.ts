import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLeague } from "@/lib/soccer/leagues";
import { soccerArticleProduct } from "@/lib/credits";
import { isSoccerArticleLocked } from "@/lib/soccer/article-access";
import { isAdminUser } from "@/lib/admin-access";

/**
 * One soccer report with the HARD paywall enforced (same contract as
 * /api/kbo/article/[team]/[date]): the public header always comes back; the
 * body only when the report is free-by-age or the signed-in user owns it.
 * Per-user, so never cached.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { league: string; team: string; date: string } },
) {
  const { league, team, date } = params;
  if (!getLeague(league) || !/^[\w-]{1,32}$/.test(team) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("soccer_articles")
    .select("team, article_date, title, dek, teaser, body_html, brief")
    .eq("league", league)
    .eq("team", team)
    .eq("article_date", date)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "server_error" }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const header = {
    league,
    team,
    ko: (row.brief as { ko?: string } | null)?.ko ?? team,
    article_date: row.article_date,
    title: row.title,
    dek: row.dek,
    teaser: row.teaser,
  };

  if (!(await isSoccerArticleLocked(admin, league, team, date))) {
    return NextResponse.json({ ...header, locked: false, owned: true, body_html: row.body_html });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let owned = false;
  if (user) {
    if (await isAdminUser(admin, user.id)) {
      owned = true;
    } else {
      const { data: ent } = await admin
        .from("entitlements")
        .select("product")
        .eq("user_id", user.id)
        .eq("product", soccerArticleProduct(league, team, date))
        .maybeSingle();
      owned = !!ent;
    }
  }
  return NextResponse.json({ ...header, locked: true, owned, body_html: owned ? row.body_html : null });
}
