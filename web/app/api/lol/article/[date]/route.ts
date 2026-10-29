import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lolWorldsProduct } from "@/lib/credits";
import { isLolArticleLocked } from "@/lib/lol/article-access";
import { WORLDS_SEASON } from "@/lib/lol/pipeline";
import { isAdminUser } from "@/lib/admin-access";

/**
 * One Worlds match-day report with the HARD paywall (same contract as the other
 * gated report routes): header always; body only if free-by-age or owned.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { date: string } }) {
  const { date } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: row, error } = await admin.from("lol_articles")
    .select("article_date, title, dek, teaser, body_html")
    .eq("season", WORLDS_SEASON).eq("event", "worlds").eq("article_date", date).maybeSingle();
  if (error) return NextResponse.json({ error: "server_error" }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const header = { league: "worlds", team: "worlds", ko: "롤드컵", article_date: row.article_date, title: row.title, dek: row.dek, teaser: row.teaser };
  if (!(await isLolArticleLocked(admin, WORLDS_SEASON, date))) {
    return NextResponse.json({ ...header, locked: false, owned: true, body_html: row.body_html });
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let owned = false;
  if (user) {
    if (await isAdminUser(admin, user.id)) owned = true;
    else {
      const { data: ent } = await admin.from("entitlements").select("product")
        .eq("user_id", user.id).eq("product", lolWorldsProduct(WORLDS_SEASON, date)).maybeSingle();
      owned = !!ent;
    }
  }
  return NextResponse.json({ ...header, locked: true, owned, body_html: owned ? row.body_html : null });
}
