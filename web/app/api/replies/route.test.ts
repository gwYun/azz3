import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  report: { kind: "kbo-daily", id: "rep-1", reply_count: 2, locked: false, product: "p" } as unknown,
  canRead: true,
  recentCount: 0,
  inserted: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock("@/lib/admin-access", () => ({ isAdminUser: async () => false }));
vi.mock("@/lib/reports/access", async (orig) => ({
  ...(await orig<typeof import("@/lib/reports/access")>()),
  resolveReport: async () => h.report,
  canReadReport: async () => h.canRead,
}));

// Minimal chainable fake: every filter returns the chain; awaiting it resolves
// to a result chosen by the operation that started it.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let op: "select" | "count" | "insert" = "select";
      const chain: Record<string, unknown> = {};
      const ret = () => chain;
      for (const m of ["eq", "is", "gte", "in", "order", "limit"]) chain[m] = ret;
      chain.select = (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) op = "count";
        return chain;
      };
      chain.insert = (row: Record<string, unknown>) => {
        op = "insert";
        h.inserted = row;
        return chain;
      };
      chain.single = async () => ({
        data: { id: "new-1", user_id: h.user?.id, body: h.inserted?.body, created_at: "2026-10-20T00:00:00Z" },
        error: null,
      });
      chain.maybeSingle = async () => ({ data: { nickname: "홍길동" }, error: null });
      chain.then = (resolve: (v: unknown) => void) => {
        if (op === "count") return resolve({ count: h.recentCount });
        if (table === "profiles") return resolve({ data: [{ id: "user-2", nickname: "김철수" }], error: null });
        return resolve({
          data: [{ id: "r1", user_id: "user-2", body: "좋은 분석", created_at: "2026-10-19T00:00:00Z" }],
          error: null,
        });
      };
      return chain;
    },
  }),
}));

import { GET, POST } from "./route";

const get = (qs: string) => GET(new Request(`https://app.test/api/replies?${qs}`));
const post = (body: unknown) =>
  POST(
    new Request("https://app.test/api/replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const key = { kind: "kbo-daily", team: "LG", date: "2026-10-12" };

beforeEach(() => {
  h.user = { id: "user-1" };
  h.canRead = true;
  h.recentCount = 0;
  h.inserted = null;
});

describe("replies GET", () => {
  it("rejects a malformed key", async () => {
    expect((await get("kind=kbo-daily&team=XX&date=2026-10-12")).status).toBe(400);
  });

  it("returns masked authors on a readable report", async () => {
    const res = await get("kind=kbo-daily&team=LG&date=2026-10-12");
    const j = await res.json();
    expect(j.canRead).toBe(true);
    expect(j.replies[0]).toMatchObject({ author: "김*수", mine: false, canDelete: false });
  });

  it("locked + not owned: count only, no reply bodies", async () => {
    h.canRead = false;
    const j = await (await get("kind=kbo-daily&team=LG&date=2026-10-12")).json();
    expect(j).toMatchObject({ canRead: false, reply_count: 2, replies: [] });
  });
});

describe("replies POST", () => {
  it("requires login", async () => {
    h.user = null;
    expect((await post({ ...key, body: "hi" })).status).toBe(401);
  });

  it("rejects empty and over-long bodies", async () => {
    expect((await post({ ...key, body: "   " })).status).toBe(400);
    expect((await post({ ...key, body: "가".repeat(501) })).status).toBe(400);
  });

  it("blocks writing on a locked report the user doesn't own", async () => {
    h.canRead = false;
    expect((await post({ ...key, body: "hi" })).status).toBe(402);
  });

  it("rate limits", async () => {
    h.recentCount = 3;
    expect((await post({ ...key, body: "hi" })).status).toBe(429);
  });

  it("inserts against the right FK with trimmed body", async () => {
    const res = await post({ ...key, body: "  좋네요  " });
    expect(res.status).toBe(200);
    expect(h.inserted).toEqual({ kbo_article_id: "rep-1", user_id: "user-1", body: "좋네요" });
    expect((await res.json()).reply).toMatchObject({ author: "홍*동", mine: true });
  });
});
