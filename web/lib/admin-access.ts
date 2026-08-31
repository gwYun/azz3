/**
 * Staff bypass. Admins skip the paywall entirely — they never spend credits and
 * always see gated bodies. Read with the service-role client so it is
 * authoritative server-side (the client-side `isAdmin` in useAccount only drives
 * UI and is never trusted for access).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function isAdminUser(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return !!(data as { is_admin?: boolean } | null)?.is_admin;
}
