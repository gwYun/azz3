import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/pay-repo", () => ({ spendCreditForUnlock: vi.fn() }));

import * as repo from "@/lib/pay-repo";
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("https://app.test/api/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.user = { id: "user-1" };
  vi.clearAllMocks();
});

describe("unlock route", () => {
  it("spends a credit and returns unlocked", async () => {
    vi.mocked(repo.spendCreditForUnlock).mockResolvedValue("unlocked");
    const res = await POST(req({ home: "LG", away: "DOOSAN" }));
    expect(repo.spendCreditForUnlock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "kbo:LG-DOOSAN",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "unlocked", product: "kbo:LG-DOOSAN" });
  });

  it("returns already (no second charge) when already unlocked", async () => {
    vi.mocked(repo.spendCreditForUnlock).mockResolvedValue("already");
    const res = await POST(req({ home: "LG", away: "DOOSAN" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "already" });
  });

  it("returns 402 on insufficient credits", async () => {
    vi.mocked(repo.spendCreditForUnlock).mockResolvedValue("insufficient");
    const res = await POST(req({ home: "LG", away: "DOOSAN" }));
    expect(res.status).toBe(402);
  });

  it("rejects an invalid matchup (same team) without spending", async () => {
    const res = await POST(req({ home: "LG", away: "LG" }));
    expect(repo.spendCreditForUnlock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it("does not spend a credit on a free taster matchup (Samsung vs Hanwha)", async () => {
    const res = await POST(req({ home: "SS", away: "HH" }));
    expect(repo.spendCreditForUnlock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "free" });
  });

  it("401 when not logged in", async () => {
    h.user = null;
    const res = await POST(req({ home: "LG", away: "DOOSAN" }));
    expect(res.status).toBe(401);
  });
});
