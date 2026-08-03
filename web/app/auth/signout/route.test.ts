import { describe, it, expect, vi } from "vitest";

const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

import { POST } from "./route";

describe("auth signout route", () => {
  it("signs out and redirects home with 303 (POST→GET)", async () => {
    const res = await POST(
      new Request("https://app.test/auth/signout", { method: "POST" }),
    );
    expect(signOut).toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.test/");
  });
});
