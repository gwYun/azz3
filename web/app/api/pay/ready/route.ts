import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/pay-repo";
import * as kakao from "@/lib/kakaopay";
import { PREMIUM_PRODUCT, PREMIUM_PRICE_KRW, PREMIUM_ITEM_NAME } from "@/lib/premium";

/**
 * Start a Kakao Pay single payment for the premium unlock.
 *
 * Auth required. The amount is server-defined (PREMIUM_PRICE_KRW) — never taken
 * from the client. Creates the order, asks Kakao to prepare payment, stores the
 * returned tid, and returns the checkout redirect URL.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = new URL(request.url).origin;
  const admin = createAdminClient();

  const order = await repo.createOrder(admin, {
    userId: user.id,
    product: PREMIUM_PRODUCT,
    amount: PREMIUM_PRICE_KRW,
  });

  try {
    const res = await kakao.ready({
      partnerOrderId: order.id,
      partnerUserId: user.id, // opaque UUID — Kakao forbids personal info here
      itemName: PREMIUM_ITEM_NAME,
      quantity: 1,
      totalAmount: PREMIUM_PRICE_KRW,
      approvalUrl: `${origin}/api/pay/approve?order_id=${order.id}`,
      cancelUrl: `${origin}/api/pay/cancel?order_id=${order.id}`,
      failUrl: `${origin}/api/pay/fail?order_id=${order.id}`,
    });
    await repo.createPayment(admin, { orderId: order.id, tid: res.tid, raw: res });
    await repo.setOrderStatus(admin, order.id, "ready");
    return NextResponse.json({ redirectUrl: res.next_redirect_pc_url });
  } catch {
    await repo.setOrderStatus(admin, order.id, "failed");
    return NextResponse.json({ error: "payment_ready_failed" }, { status: 502 });
  }
}
