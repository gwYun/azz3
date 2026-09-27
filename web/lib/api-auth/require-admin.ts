import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin-access";

export type AdminGate =
  | { ok: true; userId: string; admin: SupabaseClient }
  | { ok: false; response: NextResponse };

/**
 * Gate an admin-only route on the signed-in user's `is_admin` flag — read
 * server-side with the service role, never the client `isAdmin` (which only
 * drives UI). 401 when signed out, 403 when signed in but not staff. On success
 * hands back the userId (for created_by attribution) and a reusable admin client.
 */
export async function requireAdmin(): Promise<AdminGate> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const admin = createAdminClient();
  if (!(await isAdminUser(admin, user.id))) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, userId: user.id, admin };
}
