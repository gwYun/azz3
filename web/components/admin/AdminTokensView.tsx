"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Admin console for Open API tokens. Talks to /api/admin/tokens (itself
 * is_admin-gated). A freshly minted token's plaintext is shown ONCE in a
 * highlighted panel — after a reload only the prefix remains, everywhere.
 */

type TokenMeta = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  expires_at: string | null;
  revoked_at: string | null;
};

const EXPIRY_OPTIONS = [
  { label: "만료 없음 (Never)", days: null as number | null },
  { label: "30일", days: 30 },
  { label: "90일", days: 90 },
  { label: "1년", days: 365 },
];

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") : "—";

function statusOf(t: TokenMeta): { label: string; cls: string } {
  if (t.revoked_at) return { label: "revoked", cls: "text-fg-dim" };
  if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now())
    return { label: "expired", cls: "text-fg-dim" };
  return { label: "active", cls: "text-cyan" };
}

export function AdminTokensView() {
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tokens", { cache: "no-store" });
      const json = await res.json();
      setTokens(json.tokens ?? []);
    } catch {
      setError("토큰 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    setFreshToken(null);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), expires_in_days: expiryDays }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "생성에 실패했습니다.");
        return;
      }
      setFreshToken(json.token);
      setName("");
      await load();
    } catch {
      setError("생성 중 오류가 발생했습니다.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string, label: string) => {
    if (!confirm(`토큰 "${label}" 을(를) 폐기하시겠습니까? 되돌릴 수 없습니다.`)) return;
    await fetch(`/api/admin/tokens/${id}`, { method: "DELETE" });
    await load();
  };

  const copy = async () => {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold text-fg">Open API 토큰</h1>
        <p className="mt-1 text-sm text-fg-muted">
          카드뉴스 생성 봇이 <code className="font-mono text-cyan">/api/v1</code> 뉴스 API에
          접근할 때 쓰는 자격 토큰을 발급·폐기합니다. 발급된 평문 토큰은 생성 직후 한 번만
          표시됩니다.
        </p>
      </header>

      {/* Create */}
      <section className="rounded-xl border border-line bg-ink-850/40 p-5">
        <h2 className="font-display text-lg font-semibold text-fg">새 토큰 발급</h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-dim">
              이름 / 용도
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="card-news-bot"
              className="mt-1 w-full rounded-md border border-line bg-ink-900 px-3 py-2 font-mono text-sm text-fg outline-none focus:border-cyan"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-dim">만료</span>
            <select
              value={expiryDays ?? ""}
              onChange={(e) => setExpiryDays(e.target.value === "" ? null : Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-line bg-ink-900 px-3 py-2 text-sm text-fg outline-none focus:border-cyan sm:w-40"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.days ?? ""}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={create}
            disabled={creating || !name.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-accent-dark disabled:opacity-40"
          >
            {creating ? "발급 중…" : "발급"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-accent-tint">{error}</p>}

        {freshToken && (
          <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent-tint">
              ⚠ 지금 복사하세요 — 다시 표시되지 않습니다
            </div>
            <div className="mt-2 flex items-center gap-3">
              <code className="flex-1 break-all rounded-md bg-ink-950 px-3 py-2 font-mono text-sm text-fg">
                {freshToken}
              </code>
              <button
                onClick={copy}
                className="shrink-0 rounded-md border border-line px-3 py-2 text-sm text-fg hover:border-cyan"
              >
                {copied ? "복사됨 ✓" : "복사"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* List */}
      <section>
        <h2 className="font-display text-lg font-semibold text-fg">발급된 토큰</h2>
        {loading ? (
          <p className="mt-2 text-sm text-fg-muted">불러오는 중…</p>
        ) : tokens.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">아직 발급된 토큰이 없습니다.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {tokens.map((t) => {
              const st = statusOf(t);
              const dead = !!t.revoked_at;
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{t.name}</span>
                      <span className={`text-xs font-medium ${st.cls}`}>· {st.label}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-fg-dim">
                      {t.token_prefix}… · {t.scopes.join(", ")}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-dim">
                      생성 {fmt(t.created_at)} · 최근 사용 {fmt(t.last_used_at)} · {t.request_count}회
                      {t.expires_at ? ` · 만료 ${fmt(t.expires_at)}` : ""}
                    </div>
                  </div>
                  {!dead && (
                    <button
                      onClick={() => revoke(t.id, t.name)}
                      className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs text-accent-tint hover:border-accent"
                    >
                      폐기
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
