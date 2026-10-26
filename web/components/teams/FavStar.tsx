"use client";

import { useT } from "@/lib/i18n-context";

/** ☆/★ toggle used for favorite teams and leagues. Stops propagation so it can sit inside clickable rows. */
export function FavStar({
  on,
  onToggle,
  label,
  size = "sm",
  className,
}: {
  on: boolean;
  onToggle: () => void;
  /** What is being starred, for the accessible label ("LG", "Premier League"). */
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useT();
  const dim = size === "md" ? "h-8 w-8 text-lg" : "h-6 w-6 text-sm";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={on}
      aria-label={`${label} — ${t(on ? "fav.remove" : "fav.add")}`}
      title={t(on ? "fav.remove" : "fav.add")}
      className={
        `inline-flex shrink-0 items-center justify-center rounded-full leading-none transition ${dim} ` +
        (on ? "text-accent hover:text-accent-tint" : "text-fg-dim hover:bg-white/5 hover:text-fg") +
        (className ? ` ${className}` : "")
      }
    >
      {on ? "★" : "☆"}
    </button>
  );
}
