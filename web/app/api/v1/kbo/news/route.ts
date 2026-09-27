import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISES, type Franchise } from "@/lib/kbo/franchise";
import { ARTICLE_LOCK_WINDOW } from "@/lib/credits";
import { newerArticleCount, lockedDateSet } from "@/lib/kbo/article-access";
import {
  serializeArticle,
  envelope,
  parseLimit,
  parseDateRange,
  type KboArticleRow,
} from "@/lib/api-v1/serialize";

/**
 * KBO daily articles for the card-news generator — the FULL content the public
 * routes gate behind the paywall. Reachable only with a valid Open API token, so
 * it returns body_html + a stripped body_text on the service-role client,
 * bypassing the consumer paywall by design.
 *
 *   GET /api/v1/kbo/news                          → latest article per team
 *   GET /api/v1/kbo/news?team=HH&limit=5          → that team's most recent N
 *   GET /api/v1/kbo/news?team=HH&date=2026-09-27  → one specific article
 *   GET /api/v1/kbo/news?from=2026-09-20&to=2026-09-27      → all teams in range
 *   GET /api/v1/kbo/news?team=HH&from=2026-09-01&limit=30   → one team's range
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEASON = 2026;
const SELECT = "team, article_date, title, dek, teaser, brief, body_html, model, published_at";

const isFranchise = (c: string | null): c is Franchise =>
  !!c && (FRANCHISES as readonly string[]).includes(c);

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, "news:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const params = url.searchParams;
  const team = params.get("team");
  const date = params.get("date");
  const from = params.get("from");
  const to = params.get("to");
  const limit = parseLimit(params.get("limit"), 10, 60);
  const admin = createAdminClient();

  if (team && !isFranchise(team)) {
    return NextResponse.json({ error: "invalid_team" }, { status: 400 });
  }

  try {
    // Back-compat single article: team + a bare `date` (no range params).
    if (team && date && !from && !to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: "invalid_date" }, { status: 400 });
      }
      const { data, error } = await admin
        .from("kbo_articles")
        .select(SELECT)
        .eq("season", SEASON)
        .eq("team", team)
        .eq("article_date", date)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const locked = (await newerArticleCount(admin, team, date)) < ARTICLE_LOCK_WINDOW;
      return NextResponse.json(envelope(serializeArticle(data as KboArticleRow, locked)));
    }

    const range = parseDateRange(params);
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });
    const { from: gte, to: lte } = range.range;

    // No filters at all → the front-page feed: latest article per team.
    if (!team && !gte && !lte) {
      const { data, error } = await admin
        .from("kbo_articles")
        .select(SELECT)
        .eq("season", SEASON)
        .order("article_date", { ascending: false })
        .limit(300);
      if (error) throw error;
      const latest = new Map<string, KboArticleRow>();
      for (const r of (data ?? []) as KboArticleRow[]) {
        if (!latest.has(r.team)) latest.set(r.team, r);
      }
      const items = FRANCHISES.filter((c) => latest.has(c))
        // Each team's newest is always within the lock window → locked on the site.
        .map((c) => serializeArticle(latest.get(c)!, true));
      return NextResponse.json(envelope(items, { count: items.length }));
    }

    // Filtered list: optional team + optional inclusive date range, newest first.
    let query = admin.from("kbo_articles").select(SELECT).eq("season", SEASON);
    if (team) query = query.eq("team", team);
    if (gte) query = query.gte("article_date", gte);
    if (lte) query = query.lte("article_date", lte);
    const { data, error } = await query
      .order("article_date", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const rows = (data ?? []) as KboArticleRow[];
    const locked = await lockedDateSet(admin, SEASON, [...new Set(rows.map((r) => r.team))]);
    const items = rows.map((r) =>
      serializeArticle(r, locked.has(`${r.team}|${r.article_date}`)),
    );
    return NextResponse.json(
      envelope(items, {
        count: items.length,
        ...(team ? { team } : {}),
        ...(gte || lte ? { from: gte, to: lte } : {}),
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "server_error", detail: e instanceof Error ? e.message : "err" },
      { status: 500 },
    );
  }
}
