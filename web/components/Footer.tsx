"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n-context";

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

const koSegments: ReactNode[] = [
  "블링커스 주식회사",
  "본점: 대전광역시 유성구 과학나래2길 1, 201-2호 (구룡동)",
  "지점(서울): 서울특별시 영등포구 63로 50, 6층(여의도동, 63한화생명빌딩)",
  "사업자등록번호: 842-85-02262",
  "전문소매업 면허 번호 : 318-5-23066",
  "통신판매업 신고번호 : 제 2022-대전유성-0485호",
  "대표 박상욱",
  <Fragment key="ko-email">문의: <FootLink href="mailto:admin@blinkers.company">admin@blinkers.company</FootLink></Fragment>,
  <FootLink key="ko-tel" href="tel:07051001526">070-5100-1526</FootLink>,
];

const enSegments: ReactNode[] = [
  "Blinkers Co., Ltd.",
  "Head Office: 1 Gwahaknarae 2-gil, Yuseong-gu, Daejeon, Suite 201-2 (Guryong-dong)",
  "Branch (Seoul): 6th Floor, 63 Hanwha Life Insurance Building, 50, 63-ro, Yeongdeungpo-gu, Seoul (Yeouido-dong)",
  "Business Registration Number: 842-85-02262",
  "Specialty Retail Business License Number: 318-5-23066",
  "Mail-order Business Registration Number: 2022-Daejeon Yuseong-0485",
  "Representative: Sangwook Park",
  <Fragment key="en-email">Inquiries: <FootLink href="mailto:admin@blinkers.company">admin@blinkers.company</FootLink></Fragment>,
  <FootLink key="en-tel" href="tel:+827051001526">+82-70-5100-1526</FootLink>,
];

export function Footer() {
  const t = useT();
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
          Copyright © 2024 Blinkers, Inc. All rights reserved.
        </p>
        <div className="mt-5 space-y-3">
          <LegalLine segments={koSegments} />
          <LegalLine segments={enSegments} />
        </div>
      </div>
    </footer>
  );
}
