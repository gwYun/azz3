import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/lib/pay-repo";
import * as kakao from "@/lib/kakaopay";
import { getPack } from "@/lib/credits";

/**
 * Start a Kakao Pay payment for a credit pack.
 *
 * Auth required. Body: { packId }. The amount + credit count are looked up
 * server-side from the pack table — never taken from the client. Creates the
 * order, asks Kakao to prepare payment, stores the tid, returns the checkout
 * redirect URL.
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

  const origin = new URL(request.url).origin;
  const admin = createAdminClient();

  const order = await repo.createOrder(admin, {
    userId: user.id,
    product: pack.id,
    amount: pack.amount,
    credits: pack.credits,
  });

  try {
    const res = await kakao.ready({
      partnerOrderId: order.id,
      partnerUserId: user.id, // opaque UUID — Kakao forbids personal info here
      itemName: `크레딧 ${pack.credits}개`,
      quantity: 1,
      totalAmount: pack.amount,
      approvalUrl: `${origin}/api/pay/approve?order_id=${order.id}`,
      cancelUrl: `${origin}/api/pay/cancel?order_id=${order.id}`,
      failUrl: `${origin}/api/pay/fail?order_id=${order.id}`,
    });
    await repo.createPayment(admin, { orderId: order.id, tid: res.tid, raw: res });
    await repo.setOrderStatus(admin, order.id, "ready");
    return NextResponse.json({ redirectUrl: res.next_redirect_pc_url });
  } catch (err) {
    console.error("[pay/ready] kakao ready failed:", err);
    await repo.setOrderStatus(admin, order.id, "failed");
    return NextResponse.json({ error: "payment_ready_failed" }, { status: 502 });
  }
}
