import type { SavedBuild } from "./types";

const KEY = "azz3.builds.v1";

function safeRead(): SavedBuild[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedBuild[];
  } catch {
    return [];
  }
}

function safeWrite(builds: SavedBuild[]): { ok: true } | { ok: false; reason: string } {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(builds));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "localStorage write failed",
    };
  }
}

export function listBuilds(): SavedBuild[] {
  return safeRead().sort((a, b) => b.saved_at - a.saved_at);
}

export function saveBuild(b: Omit<SavedBuild, "id" | "saved_at">): { ok: true; build: SavedBuild } | { ok: false; reason: string } {
  const all = safeRead();
  const next: SavedBuild = {
    ...b,
    id: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `b_${Date.now()}_${Math.floor(Math.random() * 10_000)}`,
    saved_at: Date.now(),
  };
  all.push(next);
  const result = safeWrite(all);
  if (!result.ok) return result;
  return { ok: true, build: next };
}

export function deleteBuild(id: string): { ok: true } | { ok: false; reason: string } {
  const all = safeRead().filter((b) => b.id !== id);
  return safeWrite(all);
}

/** A build is read-only when its hash doesn't match the current model. */
export function isStale(build: SavedBuild, currentHash: string): boolean {
  return build.feature_set_hash !== currentHash;
}

/**
 * Smart default name based on the build's standout stat. If Gls is high,
 * "Goal-machine build". If Ast is high, "Playmaker build". Else "Build N".
 */
export function suggestName(build: { features: Record<string, number> }, existingCount: number): string {
  const f = build.features;
  const gls = f.Gls ?? 0;
  const ast = f.Ast ?? 0;
  const xag = f.xAG_Expected ?? 0;
  if (gls >= 15 && gls > ast * 1.5) return "Goal-machine build";
  if (ast >= 8 || xag >= 7) return "Playmaker build";
  if (gls >= 8 && ast >= 5) return "All-rounder build";
  return `Build ${existingCount + 1}`;
}
