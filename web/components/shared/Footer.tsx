"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n-context";
import { POLICIES, POLICY_ORDER } from "@/lib/legal/policies";

function FootLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
    >
      {children}
    </a>
  );
}

/** Renders one legal line: segments joined by a thin vertical separator. */
function LegalLine({ segments }: { segments: ReactNode[] }) {
  return (
    <p className="text-[13px] leading-relaxed text-fg-dim">
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5 text-fg-dim/50">|</span>}
          {seg}
        </span>
      ))}
    </p>
  );
}

// Required disclosures — docs/ValueTrack_Terms_and_Policies_2026.docx, Section 4.
const EMAIL = "contact@valuetrack.pro";
const SITE = "https://www.valuetrack.pro";

const koSegments: ReactNode[] = [
  "상호: 블링커스(주) (Blinkers Inc.)",
  "대표자: 박상욱",
  "사업자등록번호: 247-81-02402",
  "통신판매업신고번호: 제 2022-대전유성-0485호",
  "본점: 대전광역시 유성구 과학나래2길 1, 201-2호 (구룡동)",
  <Fragment key="ko-email">문의: <FootLink href={`mailto:${EMAIL}`}>{EMAIL}</FootLink></Fragment>,
  <Fragment key="ko-site">웹사이트: <FootLink href={SITE}>{SITE}</FootLink></Fragment>,
];

const enSegments: ReactNode[] = [
  "Blinkers Inc. (블링커스(주))",
  "Representative: Sangwook Park",
  "Business Registration Number: 247-81-02402",
  "Mail-order Business Registration Number: 2022-Daejeon Yuseong-0485",
  "Head Office: 1 Gwahaknarae 2-gil, Yuseong-gu, Daejeon, Suite 201-2 (Guryong-dong)",
  <Fragment key="en-email">Inquiries: <FootLink href={`mailto:${EMAIL}`}>{EMAIL}</FootLink></Fragment>,
  <Fragment key="en-site">Website: <FootLink href={SITE}>{SITE}</FootLink></Fragment>,
];

export function Footer() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  // The /contact page is itself the partnership CTA's destination, so hide the
  // CTA there to avoid a circular "Contact Us" link back to the same page.
  const showPartnership = pathname !== "/contact";
  return (
    <footer className="relative z-10 mt-16 border-t border-line bg-ink-950/60 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-14">
        {showPartnership && (
          <>
            {/* Partnership CTA */}
            <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
                {t("footer.partnership")}
              </h2>
              <Link
                href="/contact"
                className="group inline-flex shrink-0 items-center gap-3 rounded-full bg-accent py-2.5 pl-7 pr-2.5 text-base font-semibold text-ink-950 transition hover:bg-accent-dark"
              >
                {t("footer.contact")}
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 text-accent transition-transform group-hover:translate-x-0.5">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12h14" />
                    <path d="m13 5 7 7-7 7" />
                  </svg>
                </span>
              </Link>
            </div>

            {/* Divider */}
            <div className="mt-8 border-t border-line" />
          </>
        )}

        {/* Copyright + legal */}
        <p className="mt-8 text-sm text-fg-muted">
          Copyright © 2021 Blinkers, Inc. All rights reserved.
        </p>
        <nav className="mt-4" aria-label={locale === "ko" ? "법적 고지" : "Legal"}>
          <LegalLine
            segments={POLICY_ORDER.map((id) => (
              <Link key={id} href={`/${id}`} className="font-semibold text-fg-muted transition-colors hover:text-fg">
                {locale === "ko" ? POLICIES[id].title : POLICIES[id].titleEn}
              </Link>
            ))}
          />
        </nav>
        <div className="mt-3 space-y-3">
          <LegalLine segments={locale === "ko" ? koSegments : enSegments} />
        </div>
      </div>
    </footer>
  );
}
