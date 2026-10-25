"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";
import { useAccount } from "@/lib/useAccount";
import { CREDIT_PACKS, SIGNUP_GIFT_CREDITS } from "@/lib/credits";
import { ChargeCreditsButton } from "@/components/credits/ChargeCreditsButton";
import { BetaBadge } from "@/components/credits/BetaBadge";

/**
 * Credit account view: balance, the one-time sign-up gift, free (beta) top-up
 * packs, and the list of KBO matchups the user has unlocked. Arriving with
 * ?gift=1 (from the first-login popup) claims the gift automatically.
 * Rendered inside <Suspense> (useSearchParams).
 */
export function CreditsView() {
  const t = useT();
  const { show } = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { credits, unlocked, loading, signedIn, giftAvailable, refresh } = useAccount();
  const [claiming, setClaiming] = useState(false);
  const autoClaimed = useRef(false);

  const claimGift = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await fetch("/api/credits/gift", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { status?: string } | null;
      if (res.ok && data?.status === "claimed") {
        show(t("credits.giftClaimed", { n: String(SIGNUP_GIFT_CREDITS) }));
      } else if (res.ok && data?.status === "already") {
        show(t("credits.giftAlready"));
      } else {
        show(t("credits.giftFailed"));
      }
      refresh();
    } catch {
      show(t("credits.giftFailed"));
    }
    setClaiming(false);
  }, [refresh, show, t]);

  const wantsGift = params.get("gift") === "1";
  useEffect(() => {
    if (!wantsGift || loading || autoClaimed.current) return;
    autoClaimed.current = true;
    router.replace(pathname);
    if (signedIn && giftAvailable) claimGift();
  }, [wantsGift, loading, signedIn, giftAvailable, claimGift, router, pathname]);

  const kboUnlocks = unlocked.filter((p) => p.startsWith("kbo:"));

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{t("credits.title")}</h1>
          <BetaBadge />
        </div>
        <p className="mt-1 text-sm text-fg-muted">{t("credits.desc")}</p>
      </div>

      <div className="rounded-xl border border-line bg-ink-850/40 p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-dim">
          {t("credits.balanceLabel")}
        </div>
        <div className="mt-1 font-display text-3xl font-semibold text-fg">
          {loading ? "—" : signedIn ? credits : t("credits.loginToUnlock")}
        </div>
      </div>

      {signedIn && giftAvailable && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/40 bg-accent/10 p-5">
          <div>
            <div className="font-display text-lg font-semibold text-fg">
              🎁 {t("credits.giftTitle", { n: String(SIGNUP_GIFT_CREDITS) })}
            </div>
            <p className="mt-1 text-sm text-fg-muted">{t("credits.giftDesc")}</p>
          </div>
          <button
            type="button"
            onClick={claimGift}
            disabled={claiming}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
          >
            {claiming ? t("credits.charging") : t("credits.giftClaim")}
          </button>
        </div>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">{t("credits.storeTitle")}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t("credits.betaNote")}</p>
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {CREDIT_PACKS.map((pack) => (
            <li key={pack.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-fg">
                  {t("credits.packCredits", { n: String(pack.credits) })}
                </div>
                <div className="text-xs text-fg-dim">{t("credits.freeInBeta")}</div>
              </div>
              <ChargeCreditsButton pack={pack} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">{t("credits.myUnlocks")}</h2>
        {kboUnlocks.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">{t("credits.noUnlocks")}</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {kboUnlocks.map((p) => {
              const [, team, slot] = p.split(":");
              return (
                <li
                  key={p}
                  className="rounded-md border border-line bg-ink-850/40 px-3 py-1.5 font-mono text-xs text-fg"
                >
                  {team} · {slot}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
