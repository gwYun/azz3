/**
 * Pure, testable decisions for the Kakao Pay approve flow. No I/O — the money
 * checks live here so they can be unit-tested exhaustively. The route (approve)
 * is thin glue around these + pay-repo + kakaopay.
 */

export type Order = {
  id: string;
  user_id: string;
  product: string;
  amount: number; // KRW, integer
  credits: number; // credits this order grants on approval (0 if none)
  status: OrderStatus;
};

export type OrderStatus =
  | "pending"
  | "ready"
  | "approved"
  | "failed"
  | "canceled";

/** The order must belong to the session user completing the payment. */
export function ownsOrder(order: Order | null, userId: string): order is Order {
  return !!order && order.user_id === userId;
}

/** Idempotency: a second approve redirect for an already-approved order is a no-op. */
export function isAlreadyApproved(order: Order): boolean {
  return order.status === "approved";
}

/**
 * The amount Kakao actually approved MUST equal what we stored on the order.
 * Never trust a client-supplied amount — compare Kakao's response to our record.
 */
export function approvedAmountMatches(order: Order, approvedTotal: unknown): boolean {
  return (
    typeof approvedTotal === "number" &&
    Number.isInteger(approvedTotal) &&
    approvedTotal === order.amount
  );
}
