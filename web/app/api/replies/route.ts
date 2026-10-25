import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin-access";
import {
  MAX_REPLY_LEN,
  REPLY_FK,
  canReadReport,
  maskName,
  parseReportKey,
  resolveReport,
} from "@/lib/reports/access";

/**
 * Reader replies on a report.
 *
 *   GET  /api/replies?kind=kbo-daily&team=LG&date=2026-10-12
 *   GET  /api/replies?kind=kbo-postseason&team=SPO&date=…        (team = round)
 *   GET  /api/replies?kind=soccer&league=epl&team=12&date=…
 *   POST /api/replies  { kind, team, date, league?, body }       (login required)
 *
 * report_replies is service-role only; access mirrors the report's own hard
 * paywall: a locked report's replies are hidden (count only) and closed to
 * writing until the reader owns it. Per-user, so never cached.
 */
export const dynamic = "force-dynamic";

const BURST = { windowMs: 60_000, max: 3 };
const DAILY = { windowMs: 86_400_000, max: 30 };

type ReplyRow = { id: string; user_id: string; body: string; created_at: string };

async function currentUserId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const key = parseReportKey({
    kind: p.get("kind"),
    team: p.get("team"),
    date: p.get("date"),
    league: p.get("league") ?? undefined,
  });
  if (!key) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const admin = createAdminClient();
  const report = await resolveReport(admin, key);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const userId = await currentUserId();
  const canRead = await canReadReport(admin, userId, report);
  const base = { reply_count: report.reply_count, signedIn: !!userId, canRead };
  if (!canRead) return NextResponse.json({ ...base, replies: [] });

  const { data, error } = await admin
    .from("report_replies")
    .select("id, user_id, body, created_at")
    .eq(REPLY_FK[report.kind], report.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: "server_error" }, { status: 500 });
  const rows = (data ?? []) as ReplyRow[];

  // Nicknames via service role (profiles RLS is select-own), masked before leaving.
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: profs } = await admin.from("profiles").select("id, nickname").in("id", ids);
    for (const pr of (profs ?? []) as { id: string; nickname: string | null }[]) names.set(pr.id, pr.nickname);
  }
  const isAdmin = userId ? await isAdminUser(admin, userId) : false;

  return NextResponse.json({
    ...base,
    reply_count: rows.length,
    replies: rows.map((r) => ({
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      author: maskName(names.get(r.user_id), r.user_id),
      mine: r.user_id === userId,
      canDelete: r.user_id === userId || isAdmin,
    })),
  });
}

export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const key = parseReportKey(raw);
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!key || !body || [...body].length > MAX_REPLY_LEN) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const admin = createAdminClient();
  const report = await resolveReport(admin, key);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await canReadReport(admin, userId, report))) {
    return NextResponse.json({ error: "locked" }, { status: 402 });
  }

  // Rate limit off the (user_id, created_at) index — counts soft-deleted too, so
  // post-then-delete can't dodge it.
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const recent = async (ms: number) => {
    const { count } = await admin.from("report_replies").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since(ms));
    return count ?? 0;
  };
  if ((await recent(BURST.windowMs)) >= BURST.max || (await recent(DAILY.windowMs)) >= DAILY.max) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { data: row, error } = await admin
    .from("report_replies")
    .insert({ [REPLY_FK[report.kind]]: report.id, user_id: userId, body })
    .select("id, user_id, body, created_at")
    .single();
  if (error || !row) return NextResponse.json({ error: "server_error" }, { status: 500 });

  const { data: prof } = await admin.from("profiles").select("nickname").eq("id", userId).maybeSingle();
  const r = row as ReplyRow;
  return NextResponse.json({
    reply: {
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      author: maskName((prof as { nickname?: string | null } | null)?.nickname, userId),
      mine: true,
      canDelete: true,
    },
  });
}
