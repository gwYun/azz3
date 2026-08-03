import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order, OrderStatus } from "./pay-logic";

/**
 * Data access for the payment flow, always via the service-role admin client
 * (bypasses RLS). Kept as thin, named functions so the route logic stays
 * testable by mocking this module instead of Supabase's chained query builder.
 */

export async function createOrder(
  admin: SupabaseClient,
  input: { userId: string; product: string; amount: number; credits: number },
): Promise<Order> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      user_id: input.userId,
      product: input.product,
      amount: input.amount,
      credits: input.credits,
      currency: "KRW",
      status: "pending",
    })
    .select("id, user_id, product, amount, credits, status")
    .single();
  if (error || !data) throw new Error(`createOrder failed: ${error?.message}`);
  return data as Order;
}

export async function getOrder(admin: SupabaseClient, id: string): Promise<Order | null> {
  const { data } = await admin
    .from("orders")
    .select("id, user_id, product, amount, credits, status")
    .eq("id", id)
    .maybeSingle();
  return (data as Order) ?? null;
}

export async function setOrderStatus(
  admin: SupabaseClient,
  id: string,
  status: OrderStatus,
): Promise<void> {
  await admin.from("orders").update({ status }).eq("id", id);
}

export async function createPayment(
  admin: SupabaseClient,
  input: { orderId: string; tid: string; raw: unknown },
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("payments")
    .insert({
      order_id: input.orderId,
      kakao_tid: input.tid,
      status: "ready",
      raw_response: input.raw,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createPayment failed: ${error?.message}`);
  return data as { id: string };
}

export async function getPaymentByOrder(
  admin: SupabaseClient,
  orderId: string,
): Promise<{ id: string; kakao_tid: string | null } | null> {
  const { data } = await admin
    .from("payments")
    .select("id, kakao_tid")
    .eq("order_id", orderId)
    .maybeSingle();
  return (data as { id: string; kakao_tid: string | null }) ?? null;
}

export async function markPaymentApproved(
  admin: SupabaseClient,
  input: { id: string; approvedAmount: number; pgToken: string; raw: unknown },
): Promise<void> {
  await admin
    .from("payments")
    .update({
      status: "approved",
      approved_amount: input.approvedAmount,
      pg_token: input.pgToken,
      raw_response: input.raw,
    })
    .eq("id", input.id);
}

export async function setPaymentStatusByOrder(
  admin: SupabaseClient,
  orderId: string,
  status: OrderStatus,
): Promise<void> {
  await admin.from("payments").update({ status }).eq("order_id", orderId);
}

/** Add credits to a user's balance (atomic, service-role-only RPC). */
export async function addCredits(
  admin: SupabaseClient,
  userId: string,
  amount: number,
): Promise<void> {
  const { error } = await admin.rpc("add_credits", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw new Error(`add_credits failed: ${error.message}`);
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
