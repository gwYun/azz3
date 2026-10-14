import { NextResponse } from "next/server";
import { handleSoccerDaily } from "@/lib/soccer/cron-handler";

/**
 * Grouped soccer daily refresh for Vercel Cron (path segments, not query
 * strings, so each schedule hits a distinct cron path):
 *   /api/cron/soccer-daily/big5 → the five big European leagues
 *   /api/cron/soccer-daily/rest → K League 1/2 + UEFA competitions (UCL ingest
 *                                 runs alongside UEL/UECL, which its model pools)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GROUPS: Record<string, string[]> = {
  big5: ["epl", "primera", "bundesliga", "seria", "ligue1"],
  rest: ["kleague", "kleague2", "champs", "europa", "uecl"],
};

export async function GET(request: Request, { params }: { params: { group: string } }) {
  const leagues = GROUPS[params.group];
  if (!leagues) return NextResponse.json({ error: "unknown group" }, { status: 404 });
  return handleSoccerDaily(request, leagues);
}
