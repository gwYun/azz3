import { createClient } from "@/lib/supabase/server";

/**
 * Server-side entitlement check for the current session user. Reads through RLS
 * (users can only see their own entitlements), so this is safe: a user can
 * never observe someone else's unlock. Returns false when logged out.
 *
 * Implicitly server-only — it imports the server Supabase client, which uses
 * next/headers and cannot be bundled into a Client Component.
 */
export async function hasEntitlement(product: string): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("product", product)
    .maybeSingle();

  return Boolean(data);
}
