/**
 * Team emblem URLs. Naver's sports CDN serves every club's emblem at a stable,
 * code-keyed path (the same URLs its schedule feed returns as *TeamEmblemUrl),
 * so the UI can build them from the codes it already has — no DB round-trip:
 *
 *   KBO        team/kbo/default/{franchise}.png      (HT, SS, …)
 *   K League   team/kleague/default/{teamId}.png     (K League 1 + 2)
 *   world      team/wfootball/default/{teamId}.png   (big-5 + UEFA; ids are global)
 */
import { getLeague } from "@/lib/soccer/leagues";
import { TEAM_NAMES, resolveFranchise, type Franchise } from "@/lib/kbo/franchise";

const CDN = "https://sports-phinf.pstatic.net/team";

export function kboLogoUrl(code: string): string | null {
  const f = resolveFranchise(code);
  return f ? `${CDN}/kbo/default/${f}.png` : null;
}

export function soccerLogoUrl(league: string, code: string): string | null {
  const def = getLeague(league);
  if (!def || !code) return null;
  const dir = def.upper === "kfootball" ? "kleague" : "wfootball";
  return `${CDN}/${dir}/default/${encodeURIComponent(code)}.png`;
}

/** Emblem for a team in a report-hub league id ("kbo", "epl", …); null if none (postseason rounds). */
export function teamLogoUrl(league: string, code: string): string | null {
  if (league === "kbo") return kboLogoUrl(code);
  if (league === "kbo-playoff" || league === "worlds") return null;
  return soccerLogoUrl(league, code);
}

const KBO_BY_NAME = new Map<string, Franchise>(
  (Object.entries(TEAM_NAMES) as [Franchise, { ko: string; en: string }][]).flatMap(([code, n]) => [
    [n.ko, code],
    [n.en, code],
  ]),
);

/** KBO franchise code from a display name ('KIA', 'Samsung Lions', '삼성') — for payloads that carry names only. */
export function kboCodeFromName(name: string | null | undefined): Franchise | null {
  if (!name) return null;
  return KBO_BY_NAME.get(name.trim()) ?? resolveFranchise(name);
}
