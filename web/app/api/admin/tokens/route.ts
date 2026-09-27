import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth/require-admin";
import { mintToken } from "@/lib/api-auth/token";

/**
 * Admin API-token management. Every method is gated by requireAdmin() (server-
 * side is_admin), so only staff can mint or list machine credentials.
 *
 *   GET  /api/admin/tokens  → list token METADATA (never hash/plaintext)
 *   POST /api/admin/tokens  → mint a token; returns the plaintext ONCE
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCOPES = new Set(["reports:read"]);
const MAX_EXPIRY_DAYS = 3650;

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.admin
    .from("api_tokens")
    .select(
      "id, name, token_prefix, scopes, created_at, last_used_at, request_count, expires_at, revoked_at",
    )
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    scopes?: string[];
    expires_in_days?: number | null;
  } | null;

  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  // Validate scopes (default to reports:read).
  const scopes =
    Array.isArray(body?.scopes) && body!.scopes.length > 0 ? body!.scopes : ["reports:read"];
  if (!scopes.every((s) => VALID_SCOPES.has(s))) {
    return NextResponse.json(
      { error: "invalid_scope", detail: `allowed: ${[...VALID_SCOPES].join(", ")}` },
      { status: 400 },
    );
  }

  // Optional expiry. null / omitted = never expires.
  let expiresAt: string | null = null;
  const days = body?.expires_in_days;
  if (days != null) {
    if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) {
      return NextResponse.json({ error: "invalid_expiry" }, { status: 400 });
    }
    expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  }

  const { plain, hash, prefix } = mintToken();
  const { data, error } = await gate.admin
    .from("api_tokens")
    .insert({
      name,
      token_prefix: prefix,
      token_hash: hash,
      scopes,
      created_by: gate.userId,
      expires_at: expiresAt,
    })
    .select("id, name, token_prefix, scopes, created_at, expires_at")
    .single();
  if (error) {
    return NextResponse.json({ error: "server_error", detail: error.message }, { status: 500 });
  }

  // The ONLY time the plaintext is ever returned. The client must copy it now.
  return NextResponse.json({ token: plain, meta: data }, { status: 201 });
}
