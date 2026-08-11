/**
 * Assembles the kbo.json-shaped season-forecast payload the web reads — from the
 * in-memory rows the daily ingest just built (no DB round-trip). Runs the lean
 * team-rating sim and merges in the live standings + a WAR leaderboard.
 */
import { TEAM_NAMES, type Franchise } from "./franchise";
import { simulateSeason, type TeamRate } from "./season-sim";

interface TeamStatRow {
  team: string | null; games: number | null;
  win: number | null; lose: number | null; draw: number | null; wra: number | null;
  o_run: number | null; d_r: number | null; ranking: number | null;
}
interface HitterRow {
  player_name: string | null; team: string | null; war: number | null; wrc_plus: number | null;
}
interface PitcherRow {
  player_name: string | null; team: string | null; war: number | null; era: number | null;
}

const koName = (team: string | null): string =>
  (team && TEAM_NAMES[team as Franchise]?.ko) || team || "";

export function buildSeasonPayload(
  teams: TeamStatRow[],
  hitters: HitterRow[],
  pitchers: PitcherRow[],
  opts: { season: number; sims: number; seed?: number; runId: string; modelCommit?: string | null },
) {
  const rates: TeamRate[] = teams
    .filter((t) => t.team && t.games && t.games > 0)
    .map((t) => ({
      team: t.team as string,
      rsRate: (t.o_run ?? 0) / (t.games as number),
      raRate: (t.d_r ?? 0) / (t.games as number),
    }));

  const sim = simulateSeason(rates, { sims: opts.sims, seed: opts.seed });
  const byTeam = new Map(teams.map((t) => [t.team, t]));

  const teamsOut = sim.map((r) => {
    const st = byTeam.get(r.team);
    const nm = TEAM_NAMES[r.team as Franchise] ?? { ko: r.team, en: r.team };
    return {
      en: nm.en, ko: nm.ko,
      rank: r.rank,
      championship: r.championship, pennant: r.pennant, playoff: r.playoff, first: r.first,
      off_rating: r.off_rating, def_rating: r.def_rating,
      proj_wins: r.proj_wins, rs_per_game: r.rs_per_game, ra_per_game: r.ra_per_game,
      // live standings (display)
      games: st?.games ?? null, win: st?.win ?? null, lose: st?.lose ?? null,
      draw: st?.draw ?? null, actual_win_pct: st?.wra ?? null,
    };
  });

  const players = [
    ...hitters.map((h) => ({
      name: h.player_name, franchise_ko: koName(h.team), kind: "bat" as const,
      war: h.war, metric: h.wrc_plus, metric_label: "wRC+",
    })),
    ...pitchers.map((p) => ({
      name: p.player_name, franchise_ko: koName(p.team), kind: "pit" as const,
      war: p.war, metric: p.era, metric_label: "ERA",
    })),
  ]
    .filter((p) => p.war != null && p.name)
    .sort((a, b) => (b.war as number) - (a.war as number))
    .slice(0, 20);

  const titlePick = teamsOut.reduce((best, t) => (t.championship > best.championship ? t : best), teamsOut[0]);

  return {
    version: "v3-live-team-rating",
    season: String(opts.season),
    run_id: opts.runId,
    generated_at: opts.runId,
    n_sims: opts.sims,
    source: "naver-live",
    model_commit: opts.modelCommit ?? null,
    method:
      "lean team-rating: fresh season-to-date rs/ra (shrunk 0.70) → NegBinom game model → 144-game + KBO stepladder Monte-Carlo",
    title_pick: titlePick ? { ko: titlePick.ko, prob: titlePick.championship } : null,
    teams: teamsOut,
    players,
  };
}
