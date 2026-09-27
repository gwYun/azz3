import { describe, it, expect, beforeEach, vi } from "vitest";

// Controllable fake for the service-role client the auth path uses. `row` is what
// the token lookup returns; `touched` records usage-bump calls.
const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  dbError: null as { message: string } | null,
  touched: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.row, error: h.dbError }),
        }),
      }),
    }),
    rpc: (_name: string, args: { p_id: string }) => {
      h.touched.push(args.p_id);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import { authenticateRequest, hashToken, mintToken, TOKEN_PREFIX } from "./token";

const req = (authorization?: string) =>
  new Request("https://app.test/api/v1", {
    headers: authorization ? { authorization } : {},
  });

const live = (overrides: Record<string, unknown> = {}) => ({
  id: "tok-1",
  name: "card-news-bot",
  scopes: ["reports:read"],
  expires_at: null,
  revoked_at: null,
  ...overrides,
});

beforeEach(() => {
  h.row = live();
  h.dbError = null;
  h.touched = [];
});

describe("hashToken / mintToken", () => {
  it("hashes deterministically to 64 hex chars", () => {
    const a = hashToken("azz_live_abc");
    expect(a).toBe(hashToken("azz_live_abc"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(hashToken("azz_live_abd"));
  });

  it("mints a prefixed, unique token whose hash matches", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.plain.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a.plain).not.toBe(b.plain);
    expect(a.hash).toBe(hashToken(a.plain));
    expect(a.prefix).toBe(a.plain.slice(0, 16));
    expect(a.plain).not.toBe(a.hash); // never store the plaintext
  });
});

describe("authenticateRequest", () => {
  const scope = "reports:read";

  it("401 when the Authorization header is missing", async () => {
    const r = await authenticateRequest(req(), scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("401 on a wrong-prefix token (rejected before any DB hit)", async () => {
    const r = await authenticateRequest(req("Bearer sk_test_nope"), scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
    expect(h.touched).toHaveLength(0);
  });

  it("401 when the token is unknown", async () => {
    h.row = null;
    const r = await authenticateRequest(req(`Bearer ${TOKEN_PREFIX}xyz`), scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("401 when the token is revoked", async () => {
    h.row = live({ revoked_at: "2026-01-01T00:00:00Z" });
    const r = await authenticateRequest(req(`Bearer ${TOKEN_PREFIX}xyz`), scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("401 when the token is expired", async () => {
    h.row = live({ expires_at: "2000-01-01T00:00:00Z" });
    const r = await authenticateRequest(req(`Bearer ${TOKEN_PREFIX}xyz`), scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("403 when the token lacks the required scope", async () => {
    h.row = live({ scopes: ["other:read"] });
    const r = await authenticateRequest(req(`Bearer ${TOKEN_PREFIX}xyz`), scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("accepts a live token and records a usage bump", async () => {
    const r = await authenticateRequest(req(`Bearer ${TOKEN_PREFIX}xyz`), scope);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token.name).toBe("card-news-bot");
    expect(h.touched).toEqual(["tok-1"]);
  });

  it("still honors a non-expired future expiry", async () => {
    h.row = live({ expires_at: "2099-01-01T00:00:00Z" });
    const r = await authenticateRequest(req(`Bearer ${TOKEN_PREFIX}xyz`), scope);
    expect(r.ok).toBe(true);
  });
});
