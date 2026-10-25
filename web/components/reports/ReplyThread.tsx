"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "@/lib/useAccount";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";
import { MAX_REPLY_LEN, type ReportKind } from "@/lib/reports/types";

type Reply = {
  id: string;
  body: string;
  created_at: string;
  author: string;
  mine: boolean;
  canDelete: boolean;
};

type Thread = { reply_count: number; signedIn: boolean; canRead: boolean; replies: Reply[] };

/**
 * Replies under a report. Anyone can read replies on a report they can read;
 * writing needs login. On a locked report the server returns only the count, so
 * we show the count + an unlock hint (the ArticleGate above has the CTA).
 * `reloadKey` changes after an unlock so the thread refetches with access.
 */
export function ReplyThread({
  kind,
  team,
  date,
  league,
  reloadKey,
}: {
  kind: ReportKind;
  team: string;
  date: string;
  league?: string;
  reloadKey?: unknown;
}) {
  const t = useT();
  const { show } = useToast();
  const { signedIn: accountSignedIn } = useAccount();
  const pathname = usePathname();
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const qs = new URLSearchParams({ kind, team, date, ...(league ? { league } : {}) }).toString();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/replies?${qs}`, { cache: "no-store" });
      if (res.ok) setThread((await res.json()) as Thread);
    } catch {
      /* thread is non-critical; leave it hidden */
    }
  }, [qs]);

  useEffect(() => {
    load();
  }, [load, reloadKey, accountSignedIn]);

  if (!thread) return null;

  const len = [...draft.trim()].length;

  const submit = async () => {
    if (!len || len > MAX_REPLY_LEN) return;
    setBusy(true);
    try {
      const res = await fetch("/api/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, team, date, league, body: draft }),
      });
      if (res.status === 429) return show(t("replies.rateLimited"));
      if (!res.ok) return show(t("replies.failed"));
      const { reply } = (await res.json()) as { reply: Reply };
      setThread((th) => th && { ...th, reply_count: th.reply_count + 1, replies: [...th.replies, reply] });
      setDraft("");
    } catch {
      show(t("replies.failed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("replies.deleteConfirm"))) return;
    try {
      const res = await fetch(`/api/replies/${id}`, { method: "DELETE" });
      if (!res.ok) return show(t("replies.deleteFailed"));
      setThread((th) =>
        th && { ...th, reply_count: Math.max(th.reply_count - 1, 0), replies: th.replies.filter((r) => r.id !== id) },
      );
    } catch {
      show(t("replies.deleteFailed"));
    }
  };

  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="font-display text-lg font-semibold text-fg">
        {t("replies.title")} <span className="text-fg-dim">{thread.reply_count}</span>
      </h2>

      {!thread.canRead ? (
        <p className="mt-3 text-sm text-fg-muted">{t("replies.lockedHint", { n: String(thread.reply_count) })}</p>
      ) : (
        <>
          {thread.signedIn ? (
            <div className="mt-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("replies.placeholder")}
                rows={3}
                maxLength={MAX_REPLY_LEN}
                className="w-full resize-y rounded-md border border-line bg-fg/5 px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-fg-dim">
                  {len}/{MAX_REPLY_LEN}
                </span>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !len || len > MAX_REPLY_LEN}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
                >
                  {busy ? t("replies.posting") : t("replies.submit")}
                </button>
              </div>
            </div>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(pathname)}`}
              className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95"
            >
              {t("replies.login")}
            </Link>
          )}

          {thread.replies.length === 0 ? (
            <p className="mt-6 text-sm text-fg-dim">{t("replies.empty")}</p>
          ) : (
            <ul className="mt-6 space-y-4">
              {thread.replies.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-fg/5 px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-fg-dim">
                    <span className="font-semibold text-fg-muted">
                      {r.author}
                      {r.mine && <span className="ml-1 text-accent">· {t("replies.mine")}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {new Date(r.created_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
                      {r.canDelete && (
                        <button type="button" onClick={() => remove(r.id)} className="hover:text-accent">
                          {t("replies.delete")}
                        </button>
                      )}
                    </span>
                  </div>
                  {/* Plain text only — never HTML. */}
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-fg">{r.body}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
