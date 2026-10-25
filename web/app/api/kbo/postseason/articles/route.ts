import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_SEASON } from "@/lib/kbo/ingest";
import { ROUND_KO, type PostseasonRound } from "@/lib/kbo/postseason-ids";
import { POSTSEASON_ARTICLE_LOCK_WINDOW } from "@/lib/credits";
import { selectWithReplyCount } from "@/lib/reports/reply-count";

/**
 * Public KBO postseason report index — PUBLIC fields only (never body_html).
 *   GET /api/kbo/postseason/articles             → latest report per series + series list
 *   GET /api/kbo/postseason/articles?round=SPO   → that series' archive, newest first
 * `team` in each card is the round code, so the report hub's club filter works as a series filter.
 */
export const revalidate = 300;

const ROUNDS = Object.keys(ROUND_KO) as PostseasonRound[];
type Row = { round: PostseasonRound; article_date: string; title: string; dek: string; teaser: unknown; reply_count?: number | null };

export async function GET(request: Request) {
  const round = new URL(request.url).searchParams.get("round");
  if (round && !ROUNDS.includes(round as PostseasonRound)) {
    return NextResponse.json({ error: "invalid round" }, { status: 400 });
  }
  const admin = createAdminClient();
  try {
    const { data, error } = await selectWithReplyCount("round, article_date, title, dek, teaser", (cols) => {
      const q = admin.from("kbo_postseason_articles").select(cols)
        .eq("season", CURRENT_SEASON).order("article_date", { ascending: false }).limit(100);
      return round ? q.eq("round", round) : q;
    });
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    const card = (r: Row, locked: boolean) => ({
      team: r.round, ko: ROUND_KO[r.round], article_date: r.article_date, title: r.title, dek: r.dek, teaser: r.teaser, locked, reply_count: r.reply_count ?? 0,
    });
    const present = ROUNDS.filter((r) => rows.some((x) => x.round === r) || round === r);
    const clubs = present.map((r) => ({ code: r, ko: ROUND_KO[r], en: r }));
    if (round) {
      return NextResponse.json({ round, clubs, items: rows.map((r, i) => card(r, i < POSTSEASON_ARTICLE_LOCK_WINDOW)) });
    }
    const latest = new Map<string, Row>();
    for (const r of rows) if (!latest.has(r.round)) latest.set(r.round, r);
    const cards = [...latest.values()].sort((a, b) => b.article_date.localeCompare(a.article_date)).map((r) => card(r, true));
    return NextResponse.json({ clubs, cards });
  } catch (e) {
    return NextResponse.json({ clubs: [], cards: [], items: [], error: e instanceof Error ? e.message : "err" }, { status: 200 });
  }
}
