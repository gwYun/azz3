"use client";

import { useState } from "react";
import { teamLogoUrl } from "@/lib/teams/logos";

/**
 * Club emblem on a light tile (many crests are dark/navy and vanish on the dark
 * UI). Falls back to the name's first letter when there is no emblem for the
 * code or the CDN image fails, so a missing crest never leaves a hole.
 *
 * Plain <img>, not next/image: the CDN already serves sized PNGs with long cache
 * headers, and routing ~300 crests through the optimizer buys nothing.
 */
const SIZES = {
  xs: "h-5 w-5 p-[2px] text-[9px]",
  sm: "h-6 w-6 p-[3px] text-[10px]",
  md: "h-8 w-8 p-1 text-xs",
  lg: "h-12 w-12 p-1.5 text-base",
} as const;

export function TeamLogo({
  league,
  code,
  name,
  size = "sm",
  src,
  className,
}: {
  /** Report-hub league id ("kbo", "epl", …) used to build the emblem URL. */
  league: string;
  code: string;
  name: string;
  size?: keyof typeof SIZES;
  /** Explicit emblem URL (overrides the league/code lookup). */
  src?: string | null;
  className?: string;
}) {
  const url = src ?? teamLogoUrl(league, code);
  const [failed, setFailed] = useState(false);
  const box = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${SIZES[size]} ${className ?? ""}`;

  if (!url || failed) {
    return (
      <span aria-hidden className={`${box} bg-ink-700 font-semibold text-fg-muted`}>
        {name.trim().charAt(0) || "?"}
      </span>
    );
  }
  return (
    <span aria-hidden className={`${box} bg-white`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
