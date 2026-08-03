/**
 * Kakao Pay single-payment (단건결제) REST wrappers — the current open-api
 * endpoint with SECRET_KEY auth.
 *
 *   ready   → POST /online/v1/payment/ready   → { tid, next_redirect_pc_url, … }
 *   approve → POST /online/v1/payment/approve → { amount: { total }, … }
 *
 * Test mode: CID "TC0ONETIME" + a dev secret key (developers.kakaopay.com →
 * your application → Secret key(dev)). Server-only — never import in client
 * code; KAKAOPAY_SECRET_KEY must never be a NEXT_PUBLIC_ var.
 */

const HOST = "https://open-api.kakaopay.com";

/** Merchant code. Defaults to the shared test CID for dev. */
export const KAKAOPAY_CID = process.env.KAKAOPAY_CID || "TC0ONETIME";

export class KakaoPayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "KakaoPayError";
  }
}

function secretKey(): string {
  const key = process.env.KAKAOPAY_SECRET_KEY;
  if (!key) throw new Error("KAKAOPAY_SECRET_KEY is not set (server-only)");
  return key;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: {
      Authorization: `SECRET_KEY ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new KakaoPayError(`Kakao Pay ${path} failed (${res.status})`, res.status, data);
  }
  return data as T;
}

export type ReadyParams = {
  partnerOrderId: string;
  partnerUserId: string;
  itemName: string;
  quantity: number;
  totalAmount: number;
  approvalUrl: string;
  cancelUrl: string;
  failUrl: string;
};

export type ReadyResponse = {
  tid: string;
  next_redirect_pc_url: string;
  next_redirect_mobile_url: string;
  next_redirect_app_url: string;
  created_at: string;
};

export function ready(p: ReadyParams): Promise<ReadyResponse> {
  return post<ReadyResponse>("/online/v1/payment/ready", {
    cid: KAKAOPAY_CID,
    partner_order_id: p.partnerOrderId,
    partner_user_id: p.partnerUserId,
    item_name: p.itemName,
    quantity: p.quantity,
    total_amount: p.totalAmount,
    tax_free_amount: 0,
    approval_url: p.approvalUrl,
    cancel_url: p.cancelUrl,
    fail_url: p.failUrl,
  });
}

export type ApproveParams = {
  tid: string;
  partnerOrderId: string;
  partnerUserId: string;
  pgToken: string;
};

export type ApproveResponse = {
  aid: string;
  tid: string;
  partner_order_id: string;
  partner_user_id: string;
  payment_method_type: string;
  item_name: string;
  amount: { total: number; tax_free: number; vat: number };
  approved_at: string;
};

export function approve(p: ApproveParams): Promise<ApproveResponse> {
  return post<ApproveResponse>("/online/v1/payment/approve", {
    cid: KAKAOPAY_CID,
    tid: p.tid,
    partner_order_id: p.partnerOrderId,
    partner_user_id: p.partnerUserId,
    pg_token: p.pgToken,
  });
}
