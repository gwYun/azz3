"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n-context";

/**
 * Login / logout control in the nav.
 *
 * Reads the session CLIENT-SIDE (not in a Server Component) so the public
 * pages stay statically generated — see docs/kakao-auth-payment-plan.md §5.
 * Subscribes to onAuthStateChange so the button updates after the callback
 * redirect without a hard reload.
 *
 *   pre-config      → render nothing (no Supabase env yet)
 *   session unknown → stable-size placeholder (avoids logged-out→in flash)
 *   logged out      → Kakao login button
 *   logged in       → nickname + logout (POST form)
 */
export function AuthButton() {
  const t = useT();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async () => {
    const supabase = createClient();
    // Supabase's Kakao provider requests account_email + profile_* by default,
    // and APPENDS (does not replace) any `scopes` option — so email can't be
    // dropped client-side. That's fine: keep the Kakao email consent item
    // OPTIONAL (선택 동의) so it never hard-blocks, and key identity on the
    // provider sub, not email (email may be null). See plan §3 (OV5).
    await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  if (!isSupabaseConfigured) return null;

  if (!ready) {
    return <div className="h-7 w-[92px]" aria-hidden />;
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={signIn}
        className="inline-flex items-center gap-1.5 rounded-md bg-[#FEE500] px-3 py-1.5 text-xs font-semibold text-[#191600] transition hover:brightness-95"
      >
        {t("auth.loginWithKakao")}
      </button>
    );
  }

  const meta = user.user_metadata ?? {};
  const name =
    (meta.name as string | undefined) ??
    (meta.nickname as string | undefined) ??
    (meta.full_name as string | undefined) ??
    t("auth.account");

  return (
    <div className="inline-flex items-center gap-2">
      <span className="max-w-[8rem] truncate text-xs text-fg-muted" title={name}>
        {name}
      </span>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:text-fg"
        >
          {t("auth.logout")}
        </button>
      </form>
    </div>
  );
}
