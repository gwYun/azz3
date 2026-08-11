/**
 * KBO franchise codes — the 10 canonical team ids the whole project keys on
 * (matches kbo/data/kbo_team_meta.json and the Python model). Naver's gateway
 * happens to use these same codes, so ingestion is a pass-through + validation.
 */
export const FRANCHISES = [
  "SS", // 삼성 라이온즈
  "LG", // LG 트윈스
  "KT", // KT 위즈
  "HT", // KIA 타이거즈 (해태)
  "OB", // 두산 베어스
  "HH", // 한화 이글스
  "NC", // NC 다이노스
  "LT", // 롯데 자이언츠
  "SK", // SSG 랜더스 (SK)
  "WO", // 키움 히어로즈 (넥센/우리)
] as const;

export type Franchise = (typeof FRANCHISES)[number];

/** Display names per franchise (from kbo/data/kbo_team_meta.json — codes survive
 * sponsor renames: SK=SSG, WO=Kiwoom, HT=KIA). */
export const TEAM_NAMES: Record<Franchise, { ko: string; en: string }> = {
  HT: { ko: "KIA", en: "KIA Tigers" },
  SS: { ko: "삼성", en: "Samsung Lions" },
  LG: { ko: "LG", en: "LG Twins" },
  OB: { ko: "두산", en: "Doosan Bears" },
  KT: { ko: "KT", en: "KT Wiz" },
  SK: { ko: "SSG", en: "SSG Landers" },
  LT: { ko: "롯데", en: "Lotte Giants" },
  HH: { ko: "한화", en: "Hanwha Eagles" },
  NC: { ko: "NC", en: "NC Dinos" },
  WO: { ko: "키움", en: "Kiwoom Heroes" },
};

const FRANCHISE_SET = new Set<string>(FRANCHISES);

/** A few defensive aliases in case Naver ever emits a variant spelling. */
const ALIASES: Record<string, Franchise> = {
  SSG: "SK",
  KIA: "HT",
  넥센: "WO",
  키움: "WO",
};

/**
 * Normalize a Naver team code to a canonical franchise code, or null if it's
 * not a KBO team (all-star, exhibition, unknown). Callers drop null rows.
 */
export function resolveFranchise(code: string | null | undefined): Franchise | null {
  if (!code) return null;
  const up = code.trim().toUpperCase();
  if (FRANCHISE_SET.has(up)) return up as Franchise;
  const raw = code.trim();
  return ALIASES[up] ?? ALIASES[raw] ?? null;
}
