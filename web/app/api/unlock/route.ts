import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/pay-repo";
import { kboProduct, isFreeTeam, type Slot } from "@/lib/credits";

/**
 * Spend 1 credit to unlock a team in a slot (home or away). Auth required.
 * Body: { team, slot }. Unlocks are per team per slot, so unlocking LG as home
 * is separate from LG as away.
 *
 * Atomic + idempotent in the DB (spend_credit_for_unlock):
 *   already unlocked → no charge; balance < 1 → 402. Free teams never charge.
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
    | { team?: string; slot?: string }
    | null;
  const team = body?.team?.trim();
  const slot = body?.slot;
  if (!team || (slot !== "home" && slot !== "away")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (isFreeTeam(team)) {
    return NextResponse.json({ status: "free" });
  }

  const product = kboProduct(team, slot as Slot);
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
