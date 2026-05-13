import type { FeatureName, FeatureVector, ModelInfo } from "./types";

/**
 * URL-encoded shareable build state. 15 floats fits trivially in a URL hash.
 * Encoding: comma-separated values, in `model_info.features` order, base64-encoded.
 *
 * Format: #b=<base64(value,value,value,...)>
 *
 * Decoder is forgiving — any malformed hash returns null and the page loads
 * with default state. No exceptions bubble up to the user.
 */

const PREFIX = "b=";

export function encodeShareLink(features: FeatureVector, info: ModelInfo): string {
  const ordered = info.features.map((f) => features[f] ?? info.medians[f]);
  const csv = ordered.map((v) => Number(v.toFixed(3))).join(",");
  // base64 with URL-safe chars; no padding (= is awkward in chat)
  const b64 = typeof btoa !== "undefined"
    ? btoa(csv)
    : Buffer.from(csv).toString("base64");
  const safe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${PREFIX}${safe}`;
}

export function decodeShareHash(hash: string, info: ModelInfo): FeatureVector | null {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!cleaned.startsWith(PREFIX)) return null;
  const safe = cleaned.slice(PREFIX.length);
  if (!safe) return null;
  const b64 = safe.replace(/-/g, "+").replace(/_/g, "/");
  let csv: string;
  try {
    csv = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return null;
  }
  const parts = csv.split(",");
  if (parts.length !== info.features.length) return null;
  const out: FeatureVector = {};
  for (let i = 0; i < info.features.length; i++) {
    const feat: FeatureName = info.features[i]!;
    const n = Number(parts[i]);
    if (!isFinite(n)) return null;
    out[feat] = n;
  }
  return out;
}

export function buildShareUrl(features: FeatureVector, info: ModelInfo): string {
  const hash = encodeShareLink(features, info);
  if (typeof window === "undefined") return `#${hash}`;
  const base = `${window.location.origin}/build`;
  return `${base}#${hash}`;
}
