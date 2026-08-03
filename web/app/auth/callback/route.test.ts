import { describe, it, expect, vi, beforeEach } from "vitest";

// Fully mock the server Supabase client so the route's cookie/next-headers
// machinery is out of the picture — we only test the 3-branch decision.
const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "./route";

const req = (qs: string) => new Request(`https://app.test/auth/callback${qs}`);
const loc = (res: Response) => res.headers.get("location");

beforeEach(() => {
  exchangeCodeForSession.mockReset();
});

describe("auth callback route", () => {
  it("exchanges a valid code and redirects to next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(req("?code=abc&next=/saved"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(loc(res)).toBe("https://app.test/saved");
  });

  it("defaults to home when next is missing", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(req("?code=abc"));
    expect(loc(res)).toBe("https://app.test/");
  });

  it("ignores an off-origin next (open-redirect guard)", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(req("?code=abc&next=//evil.com"));
    expect(loc(res)).toBe("https://app.test/");
  });

  it("shows a canceled notice on the error param, without exchanging", async () => {
    const res = await GET(req("?error=access_denied"));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(loc(res)).toBe("https://app.test/?auth=canceled");
  });

  it("shows an error notice when neither code nor error is present", async () => {
    const res = await GET(req(""));
    expect(loc(res)).toBe("https://app.test/?auth=error");
  });

  it("shows an error notice when the exchange fails (expired/forged code)", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("bad code") });
    const res = await GET(req("?code=stale"));
    expect(loc(res)).toBe("https://app.test/?auth=error");
  });
});
