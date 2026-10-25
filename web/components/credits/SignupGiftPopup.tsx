"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n-context";
import { useAccount } from "@/lib/useAccount";
import { SIGNUP_GIFT_CREDITS } from "@/lib/credits";
import { BetaBadge } from "@/components/credits/BetaBadge";

const DISMISS_KEY = "vt:signup-gift-dismissed";

/**
 * First-login popup: while the one-time sign-up gift is unclaimed, invite the
 * user to /credits?gift=1 (which claims it). "Later" hides it for the browser
 * session; it comes back next session until the gift is claimed. Never shown on
 * /credits itself — that page has its own gift card.
 */
export function SignupGiftPopup() {
  const t = useT();
  const path = usePathname();
  const { signedIn, giftAvailable, loading } = useAccount();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  if (loading || !signedIn || !giftAvailable || dismissed || path === "/credits") return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signup-gift-title"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-ink-900 p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl">🎁</div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <h2 id="signup-gift-title" className="font-display text-xl font-semibold text-fg">
            {t("credits.giftTitle", { n: String(SIGNUP_GIFT_CREDITS) })}
          </h2>
          <BetaBadge />
        </div>
        <p className="mt-2 text-sm text-fg-muted">{t("credits.giftPopupDesc")}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href="/credits?gift=1"
            onClick={dismiss}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95"
          >
            {t("credits.giftPopupCta")}
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md px-4 py-2 text-sm text-fg-dim transition hover:bg-white/5 hover:text-fg"
          >
            {t("credits.giftPopupLater")}
          </button>
        </div>
      </div>
    </div>
  );
}
