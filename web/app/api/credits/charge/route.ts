import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/credits-repo";
import { getPack, BETA_MAX_BALANCE } from "@/lib/credits";

/**
 * BETA free top-up: { packId } → adds that pack's credits at no charge.
 * Auth required. The credit count comes from the server-side pack table; a
 * top-up that would push the balance past BETA_MAX_BALANCE is refused (409).
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { packId?: string } | null;
  const pack = body?.packId ? getPack(body.packId) : null;
  if (!pack) {
    return NextResponse.json({ error: "invalid_pack" }, { status: 400 });
  }

  const admin = createAdminClient();
  const balance = await repo.getCredits(admin, user.id);
  if (balance + pack.credits > BETA_MAX_BALANCE) {
    return NextResponse.json({ error: "balance_cap", max: BETA_MAX_BALANCE }, { status: 409 });
  }

  const credits = await repo.addCredits(admin, user.id, pack.credits);
  return NextResponse.json({ status: "charged", credits });
}
