import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownsOrder, type OrderStatus } from "@/lib/pay-logic";
import * as repo from "@/lib/pay-repo";

/**
 * Shared handler for the fail/cancel redirect URLs Kakao Pay calls. Marks the
 * order + payment terminal — but only if the session user owns the order and it
 * isn't already approved (so a stray cancel can't undo a paid order). Always
 * ends on a redirect to /credits with a notice.
 */
export async function handleTerminal(
  request: Request,
  status: Extract<OrderStatus, "failed" | "canceled">,
  notice: string,
): Promise<Response> {
  const { origin, searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && orderId) {
    const admin = createAdminClient();
    const order = await repo.getOrder(admin, orderId);
    if (ownsOrder(order, user.id) && order.status !== "approved") {
      await repo.setOrderStatus(admin, orderId, status);
      await repo.setPaymentStatusByOrder(admin, orderId, status);
    }
  }

  return NextResponse.redirect(`${origin}/credits?pay=${notice}`);
}
