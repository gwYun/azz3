import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin-access";

/**
 * DELETE /api/replies/<id> — soft-delete a reply. Author or admin only. The
 * report's reply_count is decremented by the DB trigger.
 */
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("report_replies")
    .select("id, user_id, deleted_at")
    .eq("id", params.id)
    .maybeSingle();
  const reply = row as { id: string; user_id: string; deleted_at: string | null } | null;
  if (!reply || reply.deleted_at) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (reply.user_id !== user.id && !(await isAdminUser(admin, user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("report_replies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", reply.id)
    .is("deleted_at", null);
  if (error) return NextResponse.json({ error: "server_error" }, { status: 500 });
  return NextResponse.json({ status: "deleted" });
}
