/**
 * Soccer match reports — one per team, published the DAY AFTER each of its
 * matches (KST): a review of that match + a preview of the team's next one.
 *
 * Runs in /api/cron/soccer-articles, AFTER /api/cron/soccer-daily has ingested
 * results, frozen pre-kickoff predictions, and refreshed the season sim. Inputs:
 *   review numbers   ← soccer_games (result) + soccer_match_predictions (frozen)
 *   preview numbers  ← soccer_match_predictions (next fixture), else a live fit
 *   table + odds     ← soccer_sim_snapshots (kind 'season', today's run)
 *   form / xG        ← soccer_standings (Naver), top scorers ← soccer_player_stats
 *
 * Self-healing: a team is due if it has a finished match in the last
 * LOOKBACK_DAYS with no report yet, so a run that hits its time budget (or a
 * missed day) is picked up by the next invocation. Reports stay dated the day
 * they publish.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAGUES, getLeague, type LeagueDef } from "./leagues";
import { fitLeague, kickoffMs, kstDate, loadLeagueGames, predictGame, type GameRow, type LeagueModel } from "./predictions";
import { writeSoccerProse } from "./llm";
import { renderSoccerArticle } from "./article-template";
import type { Result, SoccerBrief, TableLine, TeamPrediction, TopPlayer } from "./article-types";

const LOOKBACK_DAYS = 3;
const CONCURRENCY = 8;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

interface PredRow {
  game_id: string;
  home_team: string;
  p_home: number;
  p_draw: number;
  p_away: number;
  xg_home: number;
  xg_away: number;
  top_score: string | null;
}

interface SnapTeam {
  rank: number;
  team: string;
  name: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  rating: number;
  title: number;
  top: number;
  bottom: number;
  expPts: number;
}

/** "10/19(일) 23:00" in KST from a stored (KST-wall-clock) kickoff. */
export function kickoffLabel(g: Pick<GameRow, "kickoff" | "game_date">): string {
  const d = new Date(kickoffMs(g) + 9 * 3600 * 1000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd}(${DOW[d.getUTCDay()]}) ${hh}:${mi}`;
}

/** A match prediction re-expressed from `team`'s side (percent; score as team-opp). */
export function teamView(p: PredRow, team: string): TeamPrediction {
  const home = p.home_team === team;
  const [h, a] = (p.top_score ?? "0-0").split("-");
  return {
    win: Number((100 * (home ? p.p_home : p.p_away)).toFixed(1)),
    draw: Number((100 * p.p_draw).toFixed(1)),
    loss: Number((100 * (home ? p.p_away : p.p_home)).toFixed(1)),
    xgFor: Number(home ? p.xg_home : p.xg_away),
    xgAgainst: Number(home ? p.xg_away : p.xg_home),
    topScore: home ? `${h}-${a}` : `${a}-${h}`,
  };
}

/** Did the most likely outcome happen? */
export function predictionHit(p: TeamPrediction, r: Result): boolean {
  const best = p.win >= p.draw && p.win >= p.loss ? "W" : p.loss >= p.draw ? "L" : "D";
  return best === r;
}

/** Run `fn` over items with at most `n` in flight, stopping new work past `deadline`. */
async function pool<T, R>(items: T[], n: number, deadline: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length && Date.now() < deadline) {
      const item = items[i++];
      out.push(await fn(item));
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export interface LeagueArticleResult {
  league: string;
  due: number;
  upserted: number;
  deferred: number; // due but not reached before the time budget
  models: Record<string, number>;
  error?: string;
}

async function runLeague(
  admin: SupabaseClient,
  def: LeagueDef,
  now: Date,
  deadline: number,
  runId: string | null,
): Promise<LeagueArticleResult> {
  const today = kstDate(now);
  const since = kstDate(now, -LOOKBACK_DAYS);
  const empty = { league: def.code, due: 0, upserted: 0, deferred: 0, models: {} };

  const { data: snap } = await admin.from("soccer_sim_snapshots").select("season, payload")
    .eq("league", def.code).eq("kind", "season").order("season", { ascending: false }).limit(1).maybeSingle();
  if (!snap) return empty;
  const season = snap.season as number;
  const payload = snap.payload as { teams: SnapTeam[]; remainingFixtures: number; model: string };
  const teams = payload.teams;
  const byTeam = new Map(teams.map((t) => [t.team, t]));

  const games = (await loadLeagueGames(admin, def.code, season)).filter((g) => g.season === season);
  const finished = games.filter((g) => g.status === "RESULT" && g.home_score != null && g.away_score != null);

  // Latest finished match per team inside the lookback window.
  const latest = new Map<string, GameRow>();
  for (const g of finished) {
    if (g.game_date < since || g.game_date >= today) continue;
    for (const t of [g.home_team, g.away_team]) {
      const prev = latest.get(t);
      if (!prev || kickoffMs(g) > kickoffMs(prev)) latest.set(t, g);
    }
  }
  if (latest.size === 0) return empty;

  // Skip teams already reported (for that match, or already today).
  const { data: existing } = await admin.from("soccer_articles").select("team, review_game_id, article_date")
    .eq("league", def.code).gte("article_date", since);
  const done = new Set<string>();
  for (const r of (existing ?? []) as { team: string; review_game_id: string; article_date: string }[]) {
    done.add(`${r.team}|${r.review_game_id}`);
    if (r.article_date === today) done.add(`${r.team}|today`);
  }
  const due = [...latest.entries()].filter(([t, g]) => !done.has(`${t}|${g.game_id}`) && !done.has(`${t}|today`));
  if (due.length === 0) return empty;

  // Predictions for the reviewed + next games.
  const nextGame = (team: string): GameRow | null => {
    const up = games
      .filter((g) => g.status === "BEFORE" && !g.cancel && (g.home_team === team || g.away_team === team) && kickoffMs(g) > now.getTime())
      .sort((a, b) => kickoffMs(a) - kickoffMs(b));
    return up[0] ?? null;
  };
  const wantIds = new Set<string>();
  for (const [t, g] of due) {
    wantIds.add(g.game_id);
    const n = nextGame(t);
    if (n) wantIds.add(n.game_id);
  }
  const { data: predData } = await admin.from("soccer_match_predictions")
    .select("game_id, home_team, p_home, p_draw, p_away, xg_home, xg_away, top_score")
    .in("game_id", [...wantIds]);
  const preds = new Map(((predData ?? []) as PredRow[]).map((p) => [p.game_id, p]));

  let live: LeagueModel | null | undefined; // lazily fitted only if a preview lacks a stored prediction
  const predFor = async (g: GameRow): Promise<PredRow | null> => {
    const stored = preds.get(g.game_id);
    if (stored) return stored;
    if (live === undefined) live = await fitLeague(admin, def, today);
    if (!live) return null;
    const p = predictGame(live, g);
    return { game_id: g.game_id, home_team: g.home_team, p_home: p.pHome, p_draw: p.pDraw, p_away: p.pAway, xg_home: p.lh, xg_away: p.la, top_score: p.topScore };
  };

  // Context: Naver form/xG, top scorers, previous report per team (trend).
  const { data: stData } = await admin.from("soccer_standings").select("team_code, last_five, xg, xga, possession")
    .eq("league", def.code).eq("season", season);
  const naver = new Map(((stData ?? []) as { team_code: string; last_five: string | null; xg: number | null; xga: number | null; possession: number | null }[]).map((r) => [r.team_code, r]));

  const { data: plData } = await admin.from("soccer_player_stats").select("team_code, short_name, player_name, position, goals, assists, xg")
    .eq("league", def.code).eq("season", season).in("team_code", due.map(([t]) => t));
  const playersBy = new Map<string, TopPlayer[]>();
  for (const p of (plData ?? []) as { team_code: string; short_name: string | null; player_name: string | null; position: string | null; goals: number | null; assists: number | null; xg: number | null }[]) {
    const g = p.goals ?? 0, a = p.assists ?? 0;
    if (g + a === 0) continue;
    const list = playersBy.get(p.team_code) ?? [];
    list.push({ name: p.short_name ?? p.player_name ?? "", position: p.position, goals: g, assists: a, xg: p.xg != null ? Number(p.xg) : null });
    playersBy.set(p.team_code, list);
  }

  const { data: prevData } = await admin.from("soccer_articles").select("team, brief, article_date")
    .eq("league", def.code).lt("article_date", today).order("article_date", { ascending: false }).limit(500);
  const prevSim = new Map<string, { top: number; bottom: number }>();
  for (const r of (prevData ?? []) as { team: string; brief: { sim?: { top: number; bottom: number } } }[]) {
    if (r.brief?.sim && !prevSim.has(r.team)) prevSim.set(r.team, r.brief.sim);
  }

  const valueRank = new Map<string, number>();
  if (payload.model.startsWith("hybrid")) {
    [...teams].sort((a, b) => b.rating - a.rating).forEach((t, i) => valueRank.set(t.team, i + 1));
  }
  const table: TableLine[] = teams.map((t) => ({
    rank: t.rank, code: t.team, name: t.name, played: t.played, pts: t.pts, gd: t.gf - t.ga, top: t.top, bottom: t.bottom,
  }));
  const leaderPts = teams[0]?.pts ?? 0;
  const nameOf = (code: string, g?: GameRow) =>
    byTeam.get(code)?.name ?? (g ? (g.home_team === code ? g.home_name : g.away_name) : null) ?? code;

  const build = async ([team, g]: [string, GameRow]) => {
    try {
      const st = byTeam.get(team);
      if (!st) return null;
      const home = g.home_team === team;
      const teamScore = (home ? g.home_score : g.away_score)!;
      const oppScore = (home ? g.away_score : g.home_score)!;
      const result: Result = teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "D";
      const reviewPredRow = preds.get(g.game_id) ?? null; // frozen only — never back-fill a review
      const reviewPred = reviewPredRow ? teamView(reviewPredRow, team) : null;

      const n = nextGame(team);
      const nPred = n ? await predFor(n) : null;
      const oppNext = n ? (n.home_team === team ? n.away_team : n.home_team) : null;
      const oppSt = oppNext ? byTeam.get(oppNext) : undefined;

      const nv = naver.get(team);
      const prev = prevSim.get(team);
      const brief: SoccerBrief = {
        league: def.code, leagueKo: def.ko, season, date: today, team, ko: st.name,
        model: payload.model.startsWith("hybrid") ? "hybrid" : "results",
        zones: def.zones, remainingFixtures: payload.remainingFixtures,
        standings: {
          rank: st.rank, played: st.played, w: st.w, d: st.d, l: st.l, gf: st.gf, ga: st.ga, pts: st.pts,
          gapLeader: leaderPts - st.pts, lastFive: nv?.last_five ?? null,
        },
        review: {
          gameId: g.game_id, date: g.game_date, opp: nameOf(home ? g.away_team : g.home_team, g),
          oppCode: home ? g.away_team : g.home_team, home, teamScore, oppScore, result,
          pred: reviewPred, hit: reviewPred ? predictionHit(reviewPred, result) : null,
        },
        preview: n && nPred && oppNext ? {
          gameId: n.game_id, date: n.game_date, kickoffKst: kickoffLabel(n), opp: nameOf(oppNext, n), oppCode: oppNext,
          home: n.home_team === team, pred: teamView(nPred, team),
          oppRank: oppSt?.rank ?? null, oppPts: oppSt?.pts ?? null, oppLastFive: naver.get(oppNext)?.last_five ?? null,
        } : null,
        sim: {
          title: st.title, top: st.top, bottom: st.bottom, expPts: st.expPts,
          trendTop: prev ? Number((st.top - prev.top).toFixed(1)) : null,
          trendBottom: prev ? Number((st.bottom - prev.bottom).toFixed(1)) : null,
        },
        value: valueRank.size ? { rank: valueRank.get(team) ?? teams.length, of: teams.length } : null,
        seasonStats: nv ? { xg: nv.xg != null ? Number(nv.xg) : null, xga: nv.xga != null ? Number(nv.xga) : null, possession: nv.possession != null ? Number(nv.possession) : null } : null,
        topPlayers: (playersBy.get(team) ?? []).sort((a, b) => b.goals - a.goals || b.assists - a.assists).slice(0, 2),
        table,
      };
      const { prose, model } = await writeSoccerProse(brief);
      const r = renderSoccerArticle(brief, prose);
      return {
        league: def.code, season, team, article_date: today, review_game_id: g.game_id, next_game_id: n?.game_id ?? null,
        title: r.title, dek: r.dek, teaser: r.teaser, body_html: r.bodyHtml, brief, model, run_id: runId,
        published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
    } catch (e) {
      console.error(`[soccer-articles] ${def.code}/${team} failed:`, e instanceof Error ? e.message : e);
      return null;
    }
  };

  const built = (await pool(due, CONCURRENCY, deadline, build)).filter((r): r is NonNullable<typeof r> => r != null);
  if (built.length) {
    const { error } = await admin.from("soccer_articles").upsert(built, { onConflict: "league,team,article_date" });
    if (error) throw new Error(`soccer_articles upsert: ${error.message}`);
  }
  const models: Record<string, number> = {};
  for (const r of built) models[r.model] = (models[r.model] ?? 0) + 1;
  return { league: def.code, due: due.length, upserted: built.length, deferred: Math.max(0, due.length - built.length), models };
}

/** Generate due reports across leagues within a wall-clock budget (ms). */
export async function generateSoccerArticles(
  admin: SupabaseClient,
  opts: { leagues?: string[]; now?: Date; budgetMs?: number; runId?: string } = {},
): Promise<LeagueArticleResult[]> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const defs = (opts.leagues?.length ? opts.leagues.map(getLeague) : LEAGUES).filter((d): d is LeagueDef => !!d);
  const out: LeagueArticleResult[] = [];
  for (const def of defs) {
    if (Date.now() >= deadline) {
      out.push({ league: def.code, due: 0, upserted: 0, deferred: 0, models: {}, error: "time budget exhausted" });
      continue;
    }
    try {
      out.push(await runLeague(admin, def, now, deadline, opts.runId ?? null));
    } catch (e) {
      console.error(`[soccer-articles] ${def.code} failed:`, e);
      out.push({ league: def.code, due: 0, upserted: 0, deferred: 0, models: {}, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
