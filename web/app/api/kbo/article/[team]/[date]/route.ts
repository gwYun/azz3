import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISES, TEAM_NAMES, type Franchise } from "@/lib/kbo/franchise";
import { kboArticleProduct } from "@/lib/credits";
import { isArticleLocked } from "@/lib/kbo/article-access";
import { isAdminUser } from "@/lib/admin-access";

/**
 * One article, with the HARD paywall enforced. The body is service-role-only in
 * the DB (no public RLS), so it can only reach a reader through here, and only
 * when the article is free-by-age OR the signed-in user owns the entitlement.
 * Public header (title/dek/teaser/locked) is always returned so the page can
 * render the card + gate; body_html is null when gated.
 *
 * Per-user, so never cached.
 */
export const dynamic = "force-dynamic";

const SEASON = 2026;
const isFranchise = (c: string): c is Franchise =>
  (FRANCHISES as readonly string[]).includes(c);

export async function GET(
  _request: Request,
  { params }: { params: { team: string; date: string } },
) {
  const team = params.team;
  const date = params.date;
  if (!isFranchise(team) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("kbo_articles")
    .select("team, article_date, title, dek, teaser, body_html")
    .eq("season", SEASON)
    .eq("team", team)
    .eq("article_date", date)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const header = {
    team,
    ko: TEAM_NAMES[team].ko,
    article_date: row.article_date,
    title: row.title,
    dek: row.dek,
    teaser: row.teaser,
  };

  const locked = await isArticleLocked(admin, team, date);
  if (!locked) {
    // Old enough → free for everyone.
    return NextResponse.json({ ...header, locked: false, owned: true, body_html: row.body_html });
  }

  // Locked: only the owner (or a free-by-age miss above) sees the body.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let owned = false;
  if (user) {
    if (await isAdminUser(admin, user.id)) {
      owned = true; // Staff: full access, no entitlement needed.
    } else {
      const { data: ent } = await admin
        .from("entitlements")
        .select("product")
        .eq("user_id", user.id)
        .eq("product", kboArticleProduct(team, date))
        .maybeSingle();
      owned = !!ent;
    }
  }

  return NextResponse.json({
    ...header,
    locked: true,
    owned,
    body_html: owned ? row.body_html : null,
  });
}
