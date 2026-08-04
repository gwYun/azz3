"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";
import { useAccount } from "@/lib/useAccount";
import { CREDIT_PACKS } from "@/lib/credits";
import { BuyCreditsButton } from "@/components/BuyCreditsButton";

/**
 * Credit store + account view: balance, buyable packs, and the list of KBO
 * matchups the user has unlocked. Surfaces the ?pay= notice from the payment
 * routes as a toast. Rendered inside <Suspense> (useSearchParams).
 */
export function CreditsView() {
  const t = useT();
  const { show } = useToast();
  const params = useSearchParams();
  const { credits, unlocked, loading, signedIn } = useAccount();
  const shown = useRef(false);

  const pay = params.get("pay");
  useEffect(() => {
    if (!pay || shown.current) return;
    shown.current = true;
    const key =
      pay === "success"
        ? "credits.paySuccess"
        : pay === "canceled"
          ? "credits.payCanceled"
          : "credits.payFailed";
    show(t(key));
  }, [pay, show, t]);

  const kboUnlocks = unlocked.filter((p) => p.startsWith("kbo:"));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("credits.title")}</h1>
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

      <section>
        <h2 className="font-display text-lg font-semibold">{t("credits.storeTitle")}</h2>
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {CREDIT_PACKS.map((pack) => (
            <li key={pack.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-fg">
                  {t("credits.packCredits", { n: String(pack.credits) })}
                </div>
                <div className="text-xs text-fg-dim">
                  ₩{pack.amount.toLocaleString()} · ₩
                  {Math.round(pack.amount / pack.credits).toLocaleString()}/
                  {t("credits.perCredit")}
                </div>
              </div>
              <BuyCreditsButton pack={pack} />
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
