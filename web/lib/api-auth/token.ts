import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Open API bearer tokens — the machine credential for /api/v1. Issued by an admin
 * (web/app/api/admin/tokens), stored HASHED (see the api_tokens migration), and
 * checked here on every request.
 *
 * Design notes:
 *  - Tokens are 256-bit random, so a plain SHA-256 (no bcrypt/salt) is the right
 *    primitive: there's no low-entropy brute-force surface, and we need an exact,
 *    indexed lookup by hash.
 *  - The plaintext is `azz_live_<43-char base64url>` — the `azz_live_` marker lets
 *    us reject obviously-wrong strings before hitting the DB, and (like Stripe's
 *    `sk_live_`) makes leaked keys grep-able in logs and repos.
 */
export const TOKEN_PREFIX = "azz_live_";

/** How many leading chars of the plaintext we persist for display (e.g. in the
 *  admin list). Enough to disambiguate, far too few to guess the rest. */
const DISPLAY_PREFIX_LEN = 16;

export type ApiTokenRow = {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
};

/** SHA-256 hex of a token's plaintext — what we store and look up by. */
export function hashToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** Mint a fresh token. Returns the one-time plaintext plus exactly what the DB
 *  persists (hash + display prefix). The plaintext is never stored. */
export function mintToken(): { plain: string; hash: string; prefix: string } {
  const secret = randomBytes(32).toString("base64url");
  const plain = `${TOKEN_PREFIX}${secret}`;
  return { plain, hash: hashToken(plain), prefix: plain.slice(0, DISPLAY_PREFIX_LEN) };
}

export type AuthResult =
  | { ok: true; token: ApiTokenRow }
  | { ok: false; response: NextResponse };

function reject(status: number, error: string, detail?: string): AuthResult {
  const headers =
    status === 401
      ? { "WWW-Authenticate": 'Bearer realm="api", error="invalid_token"' }
      : undefined;
  return {
    ok: false,
    response: NextResponse.json({ error, ...(detail ? { detail } : {}) }, { status, headers }),
  };
}

/**
 * Authenticate an inbound Open API request by its `Authorization: Bearer` token.
 *
 * Returns `{ ok: true, token }` on success, or `{ ok: false, response }` with a
 * ready-to-return error: 401 for a missing / malformed / unknown / revoked /
 * expired token, 403 for a valid token that lacks `requiredScope`. On success it
 * fire-and-forgets a usage bump (never blocks or fails the request on it).
 */
export async function authenticateRequest(
  request: Request,
  requiredScope: string,
): Promise<AuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return reject(401, "unauthorized", "missing bearer token");

  const plain = match[1].trim();
  if (!plain.startsWith(TOKEN_PREFIX)) return reject(401, "unauthorized", "malformed token");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_tokens")
    .select("id, name, scopes, expires_at, revoked_at")
    .eq("token_hash", hashToken(plain))
    .maybeSingle();

  if (error) {
    return { ok: false, response: NextResponse.json({ error: "server_error" }, { status: 500 }) };
  }

  const token = data as ApiTokenRow | null;
  if (!token) return reject(401, "unauthorized", "unknown token");
  if (token.revoked_at) return reject(401, "unauthorized", "token revoked");
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    return reject(401, "unauthorized", "token expired");
  }
  if (!token.scopes?.includes(requiredScope)) {
    return reject(403, "forbidden", `missing scope: ${requiredScope}`);
  }

  // Best-effort usage tracking — swallow all outcomes so it can never affect the
  // response. Atomic increment lives in the api_token_touch() SQL function.
  void admin.rpc("api_token_touch", { p_id: token.id }).then(
    () => {},
    () => {},
  );

  return { ok: true, token };
}
