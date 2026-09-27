import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth/require-admin";

/**
 * Revoke a token. Soft-revoke (sets revoked_at) rather than delete, so the audit
 * row — who created it, when it was last used — survives. The auth path rejects
 * any token with revoked_at set, effective immediately.
 *
 *   DELETE /api/admin/tokens/{id}
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { data, error } = await gate.admin
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", params.id)
    .is("revoked_at", null) // idempotent: don't stomp an earlier revocation time
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  // Already revoked or unknown id → treat as success (idempotent revoke).
  return NextResponse.json({ status: "revoked", id: data?.id ?? params.id });
}
