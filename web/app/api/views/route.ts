import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseReportKey, resolveReport } from "@/lib/reports/access";

/**
 * POST /api/views  { kind, team, date, league? } — count one view of a report.
 * Public (views aren't gated: opening a locked report's page still counts). The
 * reader page dedupes to one call per report per browser per day; the bump is an
 * atomic RPC so concurrent views don't lose increments.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const key = parseReportKey(raw);
  if (!key) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const admin = createAdminClient();
  const report = await resolveReport(admin, key);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await admin.rpc("increment_report_view", { p_kind: report.kind, p_id: report.id });
  if (error) return NextResponse.json({ error: "server_error" }, { status: 500 });
  return NextResponse.json({ status: "counted" });
}
