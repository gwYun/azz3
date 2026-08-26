import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/pay-repo";
import { kboProduct, kboArticleProduct, isFreeTeam, type Slot } from "@/lib/credits";
import { FRANCHISES } from "@/lib/kbo/franchise";
import { isArticleLocked } from "@/lib/kbo/article-access";

/**
 * Spend 1 credit to unlock content. Auth required. Two shapes:
 *   { kind: "article", team, date } → one dated daily article
 *   { team, slot }                  → one matchup team-slot (legacy)
 *
 * Atomic + idempotent in the DB (spend_credit_for_unlock): already unlocked → no
 * charge; balance < 1 → 402. Content that isn't paywalled never charges (free
 * matchup teams; articles older than the lock window).
 */
const isFranchise = (c: unknown): c is string =>
  typeof c === "string" && (FRANCHISES as readonly string[]).includes(c);

async function spend(userId: string, product: string) {
  const admin = createAdminClient();
  const result = await repo.spendCreditForUnlock(admin, userId, product);
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

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { kind?: string; team?: string; slot?: string; date?: string }
    | null;

  // --- Daily article: { kind:"article", team, date } ---
  if (body?.kind === "article") {
    const team = body.team?.trim();
    const date = body.date?.trim();
    if (!isFranchise(team) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    // Don't charge for an article that's already free (older than the lock window).
    const admin = createAdminClient();
    if (!(await isArticleLocked(admin, team, date))) {
      return NextResponse.json({ status: "free" });
    }
    return spend(user.id, kboArticleProduct(team, date));
  }

  // --- Legacy matchup: { team, slot } ---
  const team = body?.team?.trim();
  const slot = body?.slot;
  if (!team || (slot !== "home" && slot !== "away")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (isFreeTeam(team)) {
    return NextResponse.json({ status: "free" });
  }
  return spend(user.id, kboProduct(team, slot as Slot));
}
