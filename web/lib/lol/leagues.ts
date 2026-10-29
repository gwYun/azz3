/**
 * LoL league registry — every competition the rating model trains on.
 *
 * `id` is Naver's esports `topLeagueId` (the schedule feed key). Domestic
 * leagues pin a team to a REGION; international events (MSI, EWC, Worlds) are
 * where regions meet, so they carry the cross-region signal the region prior
 * learns from. Leagues that existed only in some years (LTA in 2025, LCS/CBLOL
 * again from 2026) are listed together — an empty month is simply skipped.
 */
export type Region = "LCK" | "LPL" | "LEC" | "LCS" | "LCP" | "CBLOL";

export interface LolLeagueDef {
  id: string;           // Naver topLeagueId (+ our lol_matches.top_league)
  ko: string;
  region: Region | null; // null = international
}

export const LOL_LEAGUES: LolLeagueDef[] = [
  { id: "lck",                region: "LCK",   ko: "LCK" },
  { id: "lpl",                region: "LPL",   ko: "LPL" },
  { id: "lec",                region: "LEC",   ko: "LEC" },
  { id: "lcs",                region: "LCS",   ko: "LCS" },
  { id: "lta",                region: "LCS",   ko: "LTA" },     // 2025 Americas (north + south) — see regionOverride
  { id: "lcp",                region: "LCP",   ko: "LCP" },
  { id: "cblol",              region: "CBLOL", ko: "CBLOL" },
  { id: "msi",                region: null,    ko: "MSI" },
  { id: "ewc",                region: null,    ko: "EWC" },
  { id: "world_championship", region: null,    ko: "월드 챔피언십" },
];

export const WORLDS_TOP_LEAGUE = "world_championship";

export const getLolLeague = (id: string) => LOL_LEAGUES.find((l) => l.id === id);
