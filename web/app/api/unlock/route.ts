import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/pay-repo";
import { kboProduct, isFreeMatchup } from "@/lib/credits";

/**
 * Spend 1 credit to unlock a KBO matchup result. Auth required.
 * Body: { home, away } team codes.
 *
 * The spend is atomic + idempotent in the DB (spend_credit_for_unlock):
 *   already unlocked → no charge; balance < 1 → 402.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { home?: string; away?: string }
    | null;
  const home = body?.home?.trim();
  const away = body?.away?.trim();
  if (!home || !away || home === away) {
    return NextResponse.json({ error: "invalid_matchup" }, { status: 400 });
  }

  // Free taster matchups never spend a credit (defensive — the UI never calls
  // unlock for these, but a direct request shouldn't burn a credit).
  if (isFreeMatchup(home, away)) {
    return NextResponse.json({ status: "free" });
  }

  const product = kboProduct(home, away);
  const admin = createAdminClient();
  const result = await repo.spendCreditForUnlock(admin, user.id, product);

  switch (result) {
    case "unlocked":
    case "already":
      return NextResponse.json({ status: result, product });
    case "insufficient":
      return NextResponse.json({ error: "insufficient_credits" }, { status: 402 });
    default:
      return NextResponse.json({ error: "unlock_failed" }, { status: 500 });
  }
}
