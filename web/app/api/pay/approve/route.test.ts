import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable session user, set per test. vi.hoisted so the mock factory can read it.
const h = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/pay-repo", () => ({
  getOrder: vi.fn(),
  getPaymentByOrder: vi.fn(),
  markPaymentApproved: vi.fn(),
  setOrderStatus: vi.fn(),
  setPaymentStatusByOrder: vi.fn(),
  addCredits: vi.fn(),
}));
vi.mock("@/lib/kakaopay", () => ({ approve: vi.fn() }));

import * as repo from "@/lib/pay-repo";
import * as kakao from "@/lib/kakaopay";
import { GET } from "./route";

const req = (qs: string) => new Request(`https://app.test/api/pay/approve${qs}`);
const loc = (res: Response) => res.headers.get("location");
const order = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "order-1",
  user_id: "user-1",
  product: "credits-5",
  amount: 4500,
  credits: 5,
  status: "ready",
  ...over,
});

beforeEach(() => {
  h.user = { id: "user-1" };
  vi.clearAllMocks();
});

describe("pay approve route", () => {
  it("adds the pack's credits on a matching amount (happy path)", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order() as never);
    vi.mocked(repo.getPaymentByOrder).mockResolvedValue({ id: "pay-1", kakao_tid: "T1" });
    vi.mocked(kakao.approve).mockResolvedValue({ amount: { total: 4500 } } as never);

    const res = await GET(req("?order_id=order-1&pg_token=pg"));

    expect(kakao.approve).toHaveBeenCalled();
    expect(repo.addCredits).toHaveBeenCalledWith(expect.anything(), "user-1", 5);
    expect(loc(res)).toBe("https://app.test/credits?pay=success");
  });

  it("does NOT credit when Kakao's amount differs from the order (tamper guard)", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order({ amount: 4500 }) as never);
    vi.mocked(repo.getPaymentByOrder).mockResolvedValue({ id: "pay-1", kakao_tid: "T1" });
    vi.mocked(kakao.approve).mockResolvedValue({ amount: { total: 100 } } as never);

    const res = await GET(req("?order_id=order-1&pg_token=pg"));

    expect(repo.addCredits).not.toHaveBeenCalled();
    expect(repo.setOrderStatus).toHaveBeenCalledWith(expect.anything(), "order-1", "failed");
    expect(loc(res)).toBe("https://app.test/credits?pay=error");
  });

  it("rejects an order owned by another user without calling Kakao", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order({ user_id: "someone-else" }) as never);

    const res = await GET(req("?order_id=order-1&pg_token=pg"));

    expect(kakao.approve).not.toHaveBeenCalled();
    expect(repo.addCredits).not.toHaveBeenCalled();
    expect(loc(res)).toBe("https://app.test/credits?pay=error");
  });

  it("is idempotent for an already-approved order (no re-approve, no re-credit)", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order({ status: "approved" }) as never);

    const res = await GET(req("?order_id=order-1&pg_token=pg"));

    expect(kakao.approve).not.toHaveBeenCalled();
    expect(repo.addCredits).not.toHaveBeenCalled();
    expect(loc(res)).toBe("https://app.test/credits?pay=success");
  });

  it("errors when not logged in", async () => {
    h.user = null;
    const res = await GET(req("?order_id=order-1&pg_token=pg"));
    expect(loc(res)).toBe("https://app.test/credits?pay=error");
  });

  it("marks failed when the Kakao approve call throws", async () => {
    vi.mocked(repo.getOrder).mockResolvedValue(order() as never);
    vi.mocked(repo.getPaymentByOrder).mockResolvedValue({ id: "pay-1", kakao_tid: "T1" });
    vi.mocked(kakao.approve).mockRejectedValue(new Error("kakao down"));

    const res = await GET(req("?order_id=order-1&pg_token=pg"));

    expect(repo.addCredits).not.toHaveBeenCalled();
    expect(repo.setOrderStatus).toHaveBeenCalledWith(expect.anything(), "order-1", "failed");
    expect(loc(res)).toBe("https://app.test/credits?pay=error");
  });
});
