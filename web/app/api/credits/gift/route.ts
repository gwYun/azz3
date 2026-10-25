import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/credits-repo";
import { SIGNUP_GIFT_CREDITS } from "@/lib/credits";

/**
 * One-time sign-up gift: grants SIGNUP_GIFT_CREDITS once per account (atomic +
 * idempotent in the DB via claim_signup_gift). Auth required.
 */
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const credits = await repo.claimSignupGift(createAdminClient(), user.id, SIGNUP_GIFT_CREDITS);
  if (credits === null) {
    return NextResponse.json({ status: "already" });
  }
  return NextResponse.json({ status: "claimed", credits, gift: SIGNUP_GIFT_CREDITS });
}
