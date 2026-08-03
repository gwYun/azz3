import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/pay-repo";
import * as kakao from "@/lib/kakaopay";
import { PREMIUM_PRODUCT } from "@/lib/premium";
import { ownsOrder, isAlreadyApproved, approvedAmountMatches } from "@/lib/pay-logic";

function back(origin: string, pay: "success" | "error"): Response {
  return NextResponse.redirect(`${origin}/premium?pay=${pay}`);
}

/**
 * Kakao redirects here (approval_url) with ?pg_token after the user pays.
 * Finalizes the payment SERVER-SIDE:
 *   1. ownership   — order must belong to the session user
 *   2. idempotency — an already-approved order just succeeds (no double grant)
 *   3. approve     — call Kakao with the stored tid + pg_token
 *   4. amount      — Kakao's approved total MUST equal our recorded order amount
 *   5. grant       — mark approved + grant the entitlement (idempotent upsert)
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");
  const pgToken = searchParams.get("pg_token");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !orderId || !pgToken) return back(origin, "error");

  const admin = createAdminClient();
  const order = await repo.getOrder(admin, orderId);

  if (!ownsOrder(order, user.id)) return back(origin, "error");
  if (isAlreadyApproved(order)) return back(origin, "success");

  const payment = await repo.getPaymentByOrder(admin, orderId);
  if (!payment?.kakao_tid) return back(origin, "error");

  let approveRes;
  try {
    approveRes = await kakao.approve({
      tid: payment.kakao_tid,
      partnerOrderId: order.id,
      partnerUserId: user.id,
      pgToken,
    });
  } catch (err) {
    console.error("[pay/approve] kakao approve failed:", err);
    await repo.setOrderStatus(admin, orderId, "failed");
    await repo.setPaymentStatusByOrder(admin, orderId, "failed");
    return back(origin, "error");
  }

  if (!approvedAmountMatches(order, approveRes.amount?.total)) {
    await repo.setOrderStatus(admin, orderId, "failed");
    await repo.setPaymentStatusByOrder(admin, orderId, "failed");
    return back(origin, "error");
  }

  await repo.markPaymentApproved(admin, {
    id: payment.id,
    approvedAmount: approveRes.amount.total,
    pgToken,
    raw: approveRes,
  });
  await repo.setOrderStatus(admin, orderId, "approved");
  await repo.grantEntitlement(admin, {
    userId: user.id,
    product: PREMIUM_PRODUCT,
    sourcePaymentId: payment.id,
  });

  return back(origin, "success");
}
