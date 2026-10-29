import Link from "next/link";
import { POLICIES, POLICY_ORDER, POLICY_REVISED, type PolicyId } from "@/lib/legal/policies";

/**
 * One legal policy page (/terms, /privacy, /refund). Korean source text only —
 * see lib/legal/policies.ts. Server component: static, no client state.
 */
export function PolicyPage({ id }: { id: PolicyId }) {
  const policy = POLICIES[id];
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent">ValueTrack · {policy.titleEn}</div>
      <h1 className="mt-1.5 font-display text-3xl font-bold text-fg">{policy.title}</h1>
      <p className="mt-2 text-sm text-fg-dim">운영사: 블링커스(주) · 최종 개정일: {POLICY_REVISED}</p>

      <nav className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="법적 고지">
        {POLICY_ORDER.map((pid) => (
          <Link
            key={pid}
            href={`/${pid}`}
            aria-current={pid === id ? "page" : undefined}
            className={
              "rounded-full border px-3 py-1 transition " +
              (pid === id ? "border-accent bg-accent/15 text-fg" : "border-line text-fg-muted hover:border-accent/60 hover:text-fg")
            }
          >
            {POLICIES[pid].title}
          </Link>
        ))}
      </nav>

      <div className="mt-8 space-y-8">
        {policy.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-lg font-semibold text-fg">{s.heading}</h2>
            <div className="mt-2 space-y-1.5 text-[15px] leading-relaxed text-fg-muted">
              {s.lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
