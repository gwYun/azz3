import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISES, type Franchise } from "@/lib/kbo/franchise";
import { isArticleLocked } from "@/lib/kbo/article-access";
import { serializeArticle, envelope, type KboArticleRow } from "@/lib/api-v1/serialize";

/**
 * One KBO article by team + date, full content. Token-gated path-param twin of
 * /api/v1/kbo/news?team=&date= — handy for direct card-news links.
 *
 *   GET /api/v1/kbo/news/HH/2026-09-27
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEASON = 2026;
const SELECT = "team, article_date, title, dek, teaser, brief, body_html, model, published_at";

const isFranchise = (c: string): c is Franchise =>
  (FRANCHISES as readonly string[]).includes(c);

export async function GET(
  request: Request,
  { params }: { params: { team: string; date: string } },
) {
  const auth = await authenticateRequest(request, "reports:read");
  if (!auth.ok) return auth.response;

  const { team, date } = params;
  if (!isFranchise(team) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kbo_articles")
    .select(SELECT)
    .eq("season", SEASON)
    .eq("team", team)
    .eq("article_date", date)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const locked = await isArticleLocked(admin, team, date);
  return NextResponse.json(envelope(serializeArticle(data as KboArticleRow, locked)));
}
