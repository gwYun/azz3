import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Credit balance data access, always via the service-role admin client
 * (bypasses RLS). Kept as thin, named functions so the route logic stays
 * testable by mocking this module instead of Supabase's chained query builder.
 */

/** Current balance (0 if the profile row is missing). */
export async function getCredits(admin: SupabaseClient, userId: string): Promise<number> {
  const { data } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
  return (data as { credits?: number } | null)?.credits ?? 0;
}

/** Add credits to a user's balance (atomic, service-role-only RPC). Returns the new balance. */
export async function addCredits(
  admin: SupabaseClient,
  userId: string,
  amount: number,
): Promise<number> {
  const { data, error } = await admin.rpc("add_credits", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw new Error(`add_credits failed: ${error.message}`);
  return data as number;
}

/**
 * Grant the one-time sign-up gift (atomic, service-role-only RPC).
 * Returns the new balance, or null if the gift was already claimed.
 */
export async function claimSignupGift(
  admin: SupabaseClient,
  userId: string,
  amount: number,
): Promise<number | null> {
  const { data, error } = await admin.rpc("claim_signup_gift", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw new Error(`claim_signup_gift failed: ${error.message}`);
  return (data as number | null) ?? null;
}

/**
 * Spend 1 credit to unlock a product (atomic, service-role-only RPC).
 * Returns: 'unlocked' | 'already' | 'insufficient' | 'no_profile'.
 */
export async function spendCreditForUnlock(
  admin: SupabaseClient,
  userId: string,
  product: string,
): Promise<string> {
  const { data, error } = await admin.rpc("spend_credit_for_unlock", {
    p_user_id: userId,
    p_product: product,
  });
  if (error) throw new Error(`spend_credit_for_unlock failed: ${error.message}`);
  return data as string;
}
