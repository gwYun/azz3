/**
 * Shared shaping between stored series rows and the model: the lol_matches row
 * type, training-series extraction and the team → region map.
 */
import { LOL_LEAGUES } from "./leagues";
import type { TrainSeries } from "./model";

export interface LolMatchRow {
  game_id: string;
  top_league: string;
  league_id: string;
  start_at: string;      // timestamptz ISO
  title: string | null;
  status: string;        // RESULT | BEFORE | STARTED
  best_of: number;
  home_team: string;     // Naver teamId ('TBD' until drawn)
  away_team: string;
  home_name: string | null;
  away_name: string | null;
  home_code: string | null; // English acronym (GEN, T1, …)
  away_code: string | null;
  home_score: number;
  away_score: number;
  stadium: string | null;
}

const LEAGUE_REGION = new Map(LOL_LEAGUES.map((l) => [l.id, l.region]));
const INTL = new Set(LOL_LEAGUES.filter((l) => !l.region).map((l) => l.id));

export const isFinished = (m: Pick<LolMatchRow, "status" | "home_score" | "away_score">) =>
  m.status === "RESULT" && m.home_score + m.away_score > 0;

export function toTrainSeries(rows: LolMatchRow[]): TrainSeries[] {
  return rows
    .filter((m) => isFinished(m) && m.home_team !== "TBD" && m.away_team !== "TBD")
    .map((m) => ({
      t: Date.parse(m.start_at),
      home: m.home_team,
      away: m.away_team,
      homeMaps: m.home_score,
      awayMaps: m.away_score,
      intl: INTL.has(m.top_league),
    }));
}

/**
 * Team → region: the domestic league the team played most series in (as of
 * `asOf`, latest year weighted by recency of appearance). Teams only ever seen
 * at international events stay unmapped ('OTHER' in the model).
 */
export function buildRegionMap(rows: LolMatchRow[], asOf = Infinity): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const m of rows) {
    const region = LEAGUE_REGION.get(m.top_league);
    if (!region || Date.parse(m.start_at) >= asOf) continue;
    for (const t of [m.home_team, m.away_team]) {
      if (t === "TBD") continue;
      const c = counts.get(t) ?? new Map<string, number>();
      // Newer series count more, so a team that moved leagues maps to its current one.
      c.set(region, (c.get(region) ?? 0) + Date.parse(m.start_at) / 1e12);
      counts.set(t, c);
    }
  }
  const out = new Map<string, string>();
  for (const [t, c] of counts) out.set(t, [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}
