"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "@/lib/useAccount";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";

/**
 * Hard paywall for a daily article. The server only sends body_html when the
 * article is free-by-age or the user owns it, so unlike the matchup gate there
 * is nothing to blur — a locked article simply has no body to show. We render a
 * lock card + unlock CTA; on success we refresh the account and ask the page to
 * refetch (which now returns the body).
 */
export function ArticleGate({
  team,
  date,
  bodyHtml,
  onUnlocked,
}: {
  team: string;
  date: string;
  bodyHtml: string | null;
  onUnlocked: () => void;
}) {
  const t = useT();
  const { show } = useToast();
  const { credits, signedIn, loading, refresh } = useAccount();
  const [busy, setBusy] = useState(false);

  if (bodyHtml) {
    // Trusted: server-generated in article-template.ts (prose is escaped there).
    return <div className="kbo-article-body mt-6" dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
  }

  const unlock = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "article", team, date }),
      });
      if (res.status === 402) {
        show(t("credits.needMore"));
        refresh();
        return;
      }
      if (!res.ok) {
        show(t("credits.unlockFailed"));
        refresh();
        return;
      }
      show(t("credits.unlocked"));
      refresh();
      onUnlocked();
    } catch {
      show(t("credits.unlockFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-line bg-fg/5 p-8 text-center">
      <div className="text-4xl" aria-hidden>
        🔒
      </div>
      <p className="mt-3 font-display text-lg font-semibold text-fg">{t("credits.locked")}</p>
      <p className="mt-1 text-sm text-fg-muted">{t("news.heroLocked")}</p>
      <div className="mt-5">
        {loading ? null : !signedIn ? (
          <p className="text-sm text-fg-muted">{t("credits.loginToUnlock")}</p>
        ) : credits >= 1 ? (
          <>
            <p className="mb-3 text-sm text-fg-muted">{t("credits.balanceLine", { n: String(credits) })}</p>
            <button
              type="button"
              onClick={unlock}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
            >
              {busy ? t("credits.unlocking") : t("credits.unlockN", { n: "1" })}
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-fg-muted">{t("credits.zeroBalance")}</p>
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
