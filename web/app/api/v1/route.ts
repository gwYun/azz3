import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth/token";

/**
 * Open API root — a self-describing catalog that DOUBLES as a token check. A
 * client hits this first to confirm its bearer token works and to discover the
 * available endpoints. Requires a valid `news:read` token like every /api/v1
 * route, so a 200 here means "your token is live".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, "news:read");
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    api: "azz3 Open News API",
    version: "v1",
    authenticated_as: { name: auth.token.name, scopes: auth.token.scopes },
    docs: "/docs/OPEN_API.md",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/kbo/news",
        description:
          "KBO daily articles (full body). Params: team, date (single), " +
          "from + to (inclusive YYYY-MM-DD range), limit (max 60).",
      },
      {
        method: "GET",
        path: "/api/v1/kbo/news/{team}/{date}",
        description: "One KBO article by franchise code + YYYY-MM-DD, full body.",
      },
      {
        method: "GET",
        path: "/api/v1/soccer/{league}/daily",
        description:
          "Soccer daily digest: results, upcoming, standings, top scorers/assists. " +
          "Leagues: epl, primera, bundesliga, seria, ligue1, kleague, kleague2. " +
          "Params: date (single), from + to (inclusive range), limit (max 50).",
      },
    ],
  });
}
