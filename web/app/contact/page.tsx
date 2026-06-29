"use client";

import type { ReactNode } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";

const EMAIL = "admin@blinkers.company";

// Phone formatting mirrors the footer: international format in English,
// domestic format in Korean.
const PHONE: Record<Locale, { display: string; href: string }> = {
  en: { display: "+82-70-5100-1526", href: "tel:+827051001526" },
  ko: { display: "070-5100-1526", href: "tel:07051001526" },
};

/** Quick-contact card: an anchor styled like the rest of the app's panels. */
function ContactCard({
  href,
  icon,
  label,
  value,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <a
      href={href}
      className="panel group flex items-center gap-4 p-5 transition hover:border-cyan/40"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-ink-800/60 text-cyan transition group-hover:border-cyan/40">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-dim">
          {label}
        </span>
        <span className="truncate text-base font-medium text-fg transition group-hover:text-white">
          {value}
        </span>
      </span>
    </a>
  );
}

const mailIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const phoneIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  </svg>
);

export default function ContactPage() {
  const t = useT();
  const { locale } = useI18n();
  const phone = PHONE[locale];

  return (
    <article className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {t("contact.eyebrow")}
      </p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">
        {t("contact.title")}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
        {t("contact.subtitle")}
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <ContactCard
          href={`mailto:${EMAIL}`}
          icon={mailIcon}
          label={t("contact.email.label")}
          value={EMAIL}
        />
        <ContactCard
          href={phone.href}
          icon={phoneIcon}
          label={t("contact.phone.label")}
          value={phone.display}
        />
      </div>

      <p className="mt-8 text-sm text-fg-dim">{t("contact.note")}</p>
    </article>
  );
}
