"use client";

import { useEffect } from "react";
import type { ReportKind } from "@/lib/reports/types";

/**
 * Count a report view once per browser per report per day (localStorage dedupe;
 * if storage is unavailable we still count, just without dedupe).
 */
export function useReportView(kind: ReportKind, team: string, date: string, league?: string) {
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `azz3.viewed.${kind}.${league ?? ""}.${team}.${date}`;
    try {
      if (localStorage.getItem(key) === day) return;
      localStorage.setItem(key, day);
    } catch {
      /* private mode etc. — count anyway */
    }
    fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, team, date, league }),
      keepalive: true,
    }).catch(() => {});
  }, [kind, team, date, league]);
}
