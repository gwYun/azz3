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

/** Display meta per franchise (from kbo/data/kbo_team_meta.json — codes survive
 * sponsor renames: SK=SSG, WO=Kiwoom, HT=KIA). */
export const TEAM_NAMES: Record<Franchise, { ko: string; en: string; park: string }> = {
  HT: { ko: "KIA", en: "KIA Tigers", park: "광주" },
  SS: { ko: "삼성", en: "Samsung Lions", park: "대구" },
  LG: { ko: "LG", en: "LG Twins", park: "잠실" },
  OB: { ko: "두산", en: "Doosan Bears", park: "잠실" },
  KT: { ko: "KT", en: "KT Wiz", park: "수원" },
  SK: { ko: "SSG", en: "SSG Landers", park: "문학" },
  LT: { ko: "롯데", en: "Lotte Giants", park: "사직" },
  HH: { ko: "한화", en: "Hanwha Eagles", park: "대전" },
  NC: { ko: "NC", en: "NC Dinos", park: "창원" },
  WO: { ko: "키움", en: "Kiwoom Heroes", park: "고척" },
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
