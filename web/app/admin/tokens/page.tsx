import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin-access";
import { AdminTokensView } from "@/components/AdminTokensView";

/**
 * Admin-only API token console. Gated server-side: signed-out → /login, signed-in
 * non-staff → home. The client view (create / list / revoke) then talks to
 * /api/admin/tokens, which re-checks is_admin on every call — the redirect here
 * is UX, the route guard is the real control.
 */
export const dynamic = "force-dynamic";

export default async function AdminTokensPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(createAdminClient(), user.id))) redirect("/");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <AdminTokensView />
    </main>
  );
}
