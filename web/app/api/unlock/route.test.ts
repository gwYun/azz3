import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  isAdmin: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/admin-access", () => ({ isAdminUser: async () => h.isAdmin }));
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
  h.isAdmin = false;
  vi.clearAllMocks();
});

describe("unlock route", () => {
  it("spends a credit and unlocks the team+slot", async () => {
    vi.mocked(repo.spendCreditForUnlock).mockResolvedValue("unlocked");
    const res = await POST(req({ team: "LG", slot: "home" }));
    expect(repo.spendCreditForUnlock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "kbo:LG:home",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "unlocked", product: "kbo:LG:home" });
  });

  it("returns already (no second charge) when already unlocked", async () => {
    vi.mocked(repo.spendCreditForUnlock).mockResolvedValue("already");
    const res = await POST(req({ team: "LG", slot: "away" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "already" });
  });

  it("returns 402 on insufficient credits", async () => {
    vi.mocked(repo.spendCreditForUnlock).mockResolvedValue("insufficient");
    const res = await POST(req({ team: "LG", slot: "home" }));
    expect(res.status).toBe(402);
  });

  it("rejects an invalid slot without spending", async () => {
    const res = await POST(req({ team: "LG", slot: "middle" }));
    expect(repo.spendCreditForUnlock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it("does not spend a credit on a free team (Samsung/Hanwha)", async () => {
    const res = await POST(req({ team: "SS", slot: "home" }));
    expect(repo.spendCreditForUnlock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "free" });
  });

  it("401 when not logged in", async () => {
    h.user = null;
    const res = await POST(req({ team: "LG", slot: "home" }));
    expect(res.status).toBe(401);
  });

  it("admin bypass: unlocks without spending a credit", async () => {
    h.isAdmin = true;
    const res = await POST(req({ team: "LG", slot: "home" }));
    expect(repo.spendCreditForUnlock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "unlocked", admin: true });
  });
});
