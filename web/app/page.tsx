"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n-context";

const BADGES = [
  "landing.badge.football",
  "landing.badge.baseball",
  "landing.badge.esports",
  "landing.badge.poker",
] as const;

const FEATURES = [
  { key: "forecast", href: "/build" },
  { key: "multidomain", href: "/worldcup" },
  { key: "sim", href: "/worldcup" },
  { key: "glossary", href: "/glossary" },
] as const;

const STATS = [
  { key: "landing.stat.sims", value: "1,000,000" },
  { key: "landing.stat.transfers", value: "2,123" },
  { key: "landing.stat.accuracy", value: "ρ 0.85" },
] as const;

export default function LandingPage() {
  const t = useT();
  return (
    <div className="-mt-4">
      {/* Hero */}
      <section className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div className="order-2 lg:order-1">
          <Radar t={t} />
        </div>

        <div className="order-1 lg:order-2">
          <div className="flex flex-wrap gap-2">
            {BADGES.map((b) => (
              <span key={b} className="chip">
                {t(b)}
              </span>
            ))}
          </div>

          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-cyan">
            {t("landing.eyebrow")}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold uppercase leading-[1.05] tracking-tight text-fg sm:text-5xl">
            {t("landing.title")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-fg-muted">
            {t("landing.subtitle")}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/build" className="btn-primary">
              {t("landing.cta.primary")}
            </Link>
            <Link href="/worldcup" className="btn-secondary">
              {t("landing.cta.secondary")}
            </Link>
          </div>

          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6">
            {STATS.map((s) => (
              <div key={s.key}>
                <dt className="text-xs uppercase tracking-wide text-fg-dim">{t(s.key)}</dt>
                <dd className="mt-1 font-display text-xl font-semibold text-fg">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Key features */}
      <section className="mt-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-dim">
          {t("landing.features.title")}
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <Link
              key={f.key}
              href={f.href}
              className="card group p-5 transition hover:border-cyan/30 hover:bg-ink-800/70"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-ink-800/70 text-cyan transition group-hover:border-cyan/40">
                <span className="h-2 w-2 rounded-sm bg-accent" />
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-fg">
                {t(`landing.feature.${f.key}.title` as Parameters<typeof t>[0])}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                {t(`landing.feature.${f.key}.body` as Parameters<typeof t>[0])}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Hexagon radar visual — mirrors the ValueTrack reference hero charts. */
function Radar({ t }: { t: ReturnType<typeof useT> }) {
  const cx = 160;
  const cy = 160;
  const R = 120;
  const axes = [
    "landing.radar.axis1",
    "landing.radar.axis2",
    "landing.radar.axis3",
    "landing.radar.axis4",
    "landing.radar.axis5",
    "landing.radar.axis6",
  ] as const;
  // Pointy-top hexagon: start at -90°, step 60°.
  const pt = (i: number, r: number) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ringPoly = (r: number) =>
    axes.map((_, i) => pt(i, r).join(",")).join(" ");
  const values = [0.92, 0.74, 0.81, 0.97, 0.68, 0.85];
  const dataPoly = values.map((v, i) => pt(i, R * v).join(",")).join(" ");

  return (
    <div className="relative mx-auto aspect-square w-full max-w-md">
      <div className="absolute inset-0 rounded-full bg-cyan/5 blur-2xl" />
      <svg viewBox="0 0 320 320" className="relative h-full w-full">
        {/* rings */}
        {[0.33, 0.66, 1].map((r) => (
          <polygon
            key={r}
            points={ringPoly(R * r)}
            fill="none"
            stroke="rgba(148,163,184,0.18)"
            strokeWidth={1}
          />
        ))}
        {/* spokes */}
        {axes.map((_, i) => {
          const [x, y] = pt(i, R);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(148,163,184,0.14)"
              strokeWidth={1}
            />
          );
        })}
        {/* data */}
        <polygon
          points={dataPoly}
          fill="rgba(54,197,208,0.18)"
          stroke="#36C5D0"
          strokeWidth={2}
        />
        {values.map((v, i) => {
          const [x, y] = pt(i, R * v);
          return <circle key={i} cx={x} cy={y} r={3.5} fill="#E8833A" />;
        })}
        {/* axis labels */}
        {axes.map((ax, i) => {
          const [x, y] = pt(i, R + 22);
          return (
            <text
              key={ax}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-fg-dim"
              style={{ fontSize: 11 }}
            >
              {t(ax)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
