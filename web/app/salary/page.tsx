"use client";

import { useT } from "@/lib/i18n-context";
import { KboSalaryPanel } from "@/components/KboSalaryPanel";

export default function SalaryPage() {
  const t = useT();

  return (
    <article className="mx-auto max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {t("salary.eyebrow")}
      </p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">
        {t("salary.title")}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
        {t("salary.subtitle.kbo")}
      </p>

      <section className="mt-10">
        <KboSalaryPanel />
      </section>
    </article>
  );
}
