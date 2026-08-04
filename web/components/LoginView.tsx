"use client";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n-context";

/**
 * Login page body. Currently offers Kakao; the provider list is a single block
 * so adding Google / Apple / email later is just another button here (each
 * calls signInWithOAuth with its provider, or a separate flow for email).
 */
export function LoginView() {
  const t = useT();

  const signInWith = (provider: "kakao") => async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div className="mx-auto max-w-sm py-12 text-center">
      <h1 className="font-display text-2xl font-semibold text-fg">{t("auth.loginTitle")}</h1>
      <p className="mt-2 text-sm text-fg-muted">{t("auth.loginSubtitle")}</p>

      <div className="mt-8 space-y-3">
        {isSupabaseConfigured ? (
          <button
            type="button"
            onClick={signInWith("kakao")}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#FEE500] px-4 py-2.5 text-sm font-semibold text-[#191600] transition hover:brightness-95"
          >
            {t("auth.loginWithKakao")}
          </button>
        ) : (
          <p className="text-sm text-fg-dim">{t("auth.notConfigured")}</p>
        )}
        {/* Future providers (Google, Apple, email) go here. */}
      </div>
    </div>
  );
}
