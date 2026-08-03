"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "@/lib/useAccount";
import { kboProduct } from "@/lib/credits";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";

/**
 * Soft paywall for a KBO matchup result. If the user has unlocked this pairing
 * (kbo:HOME-AWAY), the result shows. Otherwise it renders blurred behind an
 * overlay: spend 1 credit to unlock (if balance ≥ 1), or go buy credits.
 *
 * Soft by design (the sim runs client-side, so values are in the DOM under the
 * blur). Chosen tradeoff — a hard paywall would require moving the sim server-side.
 */
export function KboResultGate({
  home,
  away,
  children,
}: {
  home: string;
  away: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const { show } = useToast();
  const { credits, unlocked, loading, signedIn, refresh } = useAccount();
  const [busy, setBusy] = useState(false);

  const product = kboProduct(home, away);
  const isUnlocked = unlocked.includes(product);

  if (loading) return <div className="mt-8 h-40" aria-hidden />;
  if (isUnlocked) return <>{children}</>;

  const unlock = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home, away }),
      });
      if (res.status === 402) {
        show(t("credits.needMore"));
        setBusy(false);
        return;
      }
      if (!res.ok) {
        show(t("credits.unlockFailed"));
        setBusy(false);
        return;
      }
      show(t("credits.unlocked"));
      refresh();
      setBusy(false);
    } catch {
      show(t("credits.unlockFailed"));
      setBusy(false);
    }
  };

  return (
    <div className="relative mt-8">
      <div className="pointer-events-none select-none blur-md" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-ink-950/70 p-6 text-center backdrop-blur-sm">
        <p className="font-display text-lg font-semibold text-fg">{t("credits.locked")}</p>
        {!signedIn ? (
          <p className="text-sm text-fg-muted">{t("credits.loginToUnlock")}</p>
        ) : credits >= 1 ? (
          <>
            <p className="text-sm text-fg-muted">{t("credits.balanceLine", { n: String(credits) })}</p>
            <button
              type="button"
              onClick={unlock}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
            >
              {busy ? t("credits.unlocking") : t("credits.unlockOne")}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-muted">{t("credits.zeroBalance")}</p>
            <Link
              href="/credits"
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95"
            >
              {t("credits.buy")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
