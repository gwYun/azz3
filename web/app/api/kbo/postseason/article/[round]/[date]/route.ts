import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_SEASON } from "@/lib/kbo/ingest";
import { ROUND_KO } from "@/lib/kbo/postseason-ids";
import { kboPostseasonProduct } from "@/lib/credits";
import { isPostseasonArticleLocked } from "@/lib/kbo/article-access";
import { isAdminUser } from "@/lib/admin-access";

/**
 * One postseason series report with the HARD paywall (same contract as the
 * daily-article route): header always; body only if free-by-age or owned.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { round: string; date: string } }) {
  const { round, date } = params;
  if (!(round in ROUND_KO) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: row, error } = await admin.from("kbo_postseason_articles")
    .select("round, article_date, title, dek, teaser, body_html")
    .eq("season", CURRENT_SEASON).eq("round", round).eq("article_date", date).maybeSingle();
  if (error) return NextResponse.json({ error: "server_error" }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const header = { round, ko: ROUND_KO[round as keyof typeof ROUND_KO], article_date: row.article_date, title: row.title, dek: row.dek, teaser: row.teaser };
  if (!(await isPostseasonArticleLocked(admin, CURRENT_SEASON, round, date))) {
    return NextResponse.json({ ...header, locked: false, owned: true, body_html: row.body_html });
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let owned = false;
  if (user) {
    if (await isAdminUser(admin, user.id)) owned = true;
    else {
      const { data: ent } = await admin.from("entitlements").select("product")
        .eq("user_id", user.id).eq("product", kboPostseasonProduct(CURRENT_SEASON, round, date)).maybeSingle();
      owned = !!ent;
    }
  }
  return NextResponse.json({ ...header, locked: true, owned, body_html: owned ? row.body_html : null });
}
