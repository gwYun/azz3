"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "@/lib/useAccount";
import { isTeamSlotOpen, type Slot } from "@/lib/credits";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";

/**
 * Soft paywall for a KBO matchup result. Unlocks are per team per slot: the
 * result shows once the HOME team is open as home AND the AWAY team is open as
 * away (Samsung/Hanwha are free in both slots). Otherwise the result is blurred
 * behind an overlay that unlocks whichever side(s) are still locked — 1 credit
 * each, so a fully-locked pairing costs 2.
 *
 * Soft by design (the sim runs client-side, so values are in the DOM under the
 * blur). A hard paywall would require moving the sim server-side.
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

  const homeOpen = isTeamSlotOpen(home, "home", unlocked);
  const awayOpen = isTeamSlotOpen(away, "away", unlocked);

  if (loading) return <div className="mt-8 h-40" aria-hidden />;
  if (homeOpen && awayOpen) return <>{children}</>;

  const missing: { team: string; slot: Slot }[] = [
    ...(homeOpen ? [] : [{ team: home, slot: "home" as Slot }]),
    ...(awayOpen ? [] : [{ team: away, slot: "away" as Slot }]),
  ];
  const cost = missing.length;

  const unlock = async () => {
    setBusy(true);
    try {
      for (const m of missing) {
        const res = await fetch("/api/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(m),
        });
        if (res.status === 402) {
          show(t("credits.needMore"));
          refresh();
          setBusy(false);
          return;
        }
        if (!res.ok) {
          show(t("credits.unlockFailed"));
          refresh();
          setBusy(false);
          return;
        }
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
      {/* Capped, blurred teaser so the locked block stays compact and the CTA
          sits near the top (not lost in the middle of a tall result). */}
      <div className="pointer-events-none max-h-80 select-none overflow-hidden blur-md" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-start gap-3 rounded-2xl bg-ink-950/70 p-6 pt-12 text-center backdrop-blur-sm">
        <p className="font-display text-lg font-semibold text-fg">{t("credits.locked")}</p>
        {!signedIn ? (
          <p className="text-sm text-fg-muted">{t("credits.loginToUnlock")}</p>
        ) : credits >= cost ? (
          <>
            <p className="text-sm text-fg-muted">{t("credits.balanceLine", { n: String(credits) })}</p>
            <button
              type="button"
              onClick={unlock}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
            >
              {busy ? t("credits.unlocking") : t("credits.unlockN", { n: String(cost) })}
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
