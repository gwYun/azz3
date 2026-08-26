/**
 * Daily articles pipeline — builds one newspaper column per team from the fresh
 * data the nightly ingest just wrote, and upserts them into kbo_articles.
 *
 * Called by /api/cron/kbo-daily AFTER runDailyIngest, so kbo_games (schedule +
 * results) and the season snapshot are current. The heavy numbers are computed
 * ONCE and shared across all 10 teams:
 *   standings + remaining schedule  ← kbo_games RESULT rows (regular season only)
 *   conditional 가을야구 odds         ← simulateRemaining() over the reconstructed schedule
 * Then per team we assemble a data brief, write the prose (LLM or fallback), and
 * render the HTML. All numbers come from the brief; the prose is narrative only.
 *
 * Self-contained by design: the run rates for the sim + ratings are derived here
 * from the games (shrunk like season-sim), so a missing season snapshot only
 * costs the optional context fields (power odds, top player), never the article.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FRANCHISES, TEAM_NAMES, resolveFranchise, type Franchise } from "./franchise";
import { expectedRuns, DISPERSION_K, DEFAULT_SHRINK } from "./season-sim";
import { winProbExact } from "../matchup-sim";
import { simulateRemaining, type CondTeam } from "./conditional-sim";
import { writeArticleProse } from "./llm";
import { renderArticle } from "./article-template";
import type {
  ArticleBrief,
  ArticleStandings,
  ArticleTopPlayer,
  ArticleYesterday,
  ArticleToday,
} from "./article-types";

const GAMES_PER_SEASON = 144;
const GAMES_PER_HOME_PAIR = 8; // balanced round-robin: 8 home + 8 away vs each opponent
const SIM_DRAWS = 40000;

/** KBO regular season opener (excludes the 시범경기 that pollute kbo_games). */
function regularSeasonStart(season: number): string {
  return `${season}-03-28`;
}

/** KST calendar date (server runs UTC; cron fires 05:00 KST). offsetDays shifts it. */
export function kstDateStr(base: Date, offsetDays = 0): string {
  const ms = base.getTime() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

interface GameRow {
  game_date: string | null;
  status: string | null;
  stadium: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  cancel: boolean | null;
  suspended: boolean | null;
}

interface TeamStanding {
  w: number;
  l: number;
  d: number;
  rf: number; // runs for
  ra: number; // runs against
  gp: number;
  rank: number;
  rsRate: number; // shrunk
  raRate: number; // shrunk
  offRating: number;
  defRating: number;
}

const idx = (code: string): number => FRANCHISES.indexOf(code as Franchise);

/**
 * Regular-season standings + a played-home matrix, from RESULT games only.
 * Applies the 시범경기 filter (game_date >= opener) documented in PROJECT_KNOWLEDGE §7.
 */
function computeStandings(games: GameRow[], season: number) {
  const n = FRANCHISES.length;
  const base = FRANCHISES.map(() => ({ w: 0, l: 0, d: 0, rf: 0, ra: 0, gp: 0 }));
  const playedHome: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const start = regularSeasonStart(season);

  for (const g of games) {
    if (!g.game_date || g.game_date < start) continue;
    if (g.cancel || g.suspended || g.status !== "RESULT") continue;
    if (g.home_score == null || g.away_score == null) continue;
    const hi = idx(g.home_team ?? "");
    const ai = idx(g.away_team ?? "");
    if (hi < 0 || ai < 0) continue;
    const hs = g.home_score;
    const as = g.away_score;
    base[hi].gp++;
    base[ai].gp++;
    base[hi].rf += hs;
    base[hi].ra += as;
    base[ai].rf += as;
    base[ai].ra += hs;
    playedHome[hi][ai]++;
    if (hs > as) {
      base[hi].w++;
      base[ai].l++;
    } else if (as > hs) {
      base[ai].w++;
      base[hi].l++;
    } else {
      base[hi].d++;
      base[ai].d++;
    }
  }

  // League R/G anchor + shrunk rates (same shape as season-sim / matchup teamRatings).
  const withGames = base.map((b, i) => ({ b, i })).filter((x) => x.b.gp > 0);
  const rawRs = base.map((b) => (b.gp > 0 ? b.rf / b.gp : 0));
  const rawRa = base.map((b) => (b.gp > 0 ? b.ra / b.gp : 0));
  const lgRg =
    withGames.length > 0
      ? withGames.reduce((a, x) => a + rawRs[x.i] + rawRa[x.i], 0) / (2 * withGames.length)
      : 4.8;

  const standings: Record<string, TeamStanding> = {};
  const ranked = FRANCHISES.map((code, i) => {
    const b = base[i];
    const pct = b.w + b.l > 0 ? b.w / (b.w + b.l) : 0;
    return { code, i, b, pct };
  }).sort((x, y) => y.pct - x.pct || y.b.w - x.b.w || idx(x.code) - idx(y.code));

  ranked.forEach((r, rankPos) => {
    const rss = lgRg + DEFAULT_SHRINK * (rawRs[r.i] - lgRg);
    const ras = lgRg + DEFAULT_SHRINK * (rawRa[r.i] - lgRg);
    standings[r.code] = {
      w: r.b.w,
      l: r.b.l,
      d: r.b.d,
      rf: r.b.rf,
      ra: r.b.ra,
      gp: r.b.gp,
      rank: rankPos + 1,
      rsRate: Number(rss.toFixed(3)),
      raRate: Number(ras.toFixed(3)),
      offRating: Number(((100 * rss) / lgRg).toFixed(1)),
      defRating: Number(((100 * lgRg) / ras).toFixed(1)),
    };
  });

  // Games-behind helpers vs a reference team (KBO formula).
  const gb = (t: TeamStanding, ref: TeamStanding): number =>
    ((ref.w - t.w) + (t.l - ref.l)) / 2;
  const leader = ranked[0].code;
  const cut = ranked[4]?.code; // 5th seed = the 가을야구 line

  return { standings, playedHome, lgRg, ranked, gb, leader, cut };
}

/** remainingHome[i][j] = max(0, 8 − games team i has already hosted vs j). */
function remainingSchedule(playedHome: number[][]): number[][] {
  return playedHome.map((row, i) =>
    row.map((p, j) => (i === j ? 0 : Math.max(0, GAMES_PER_HOME_PAIR - p))),
  );
}

function findGameFor(games: GameRow[], date: string, code: string): GameRow | null {
  for (const g of games) {
    if (g.game_date !== date || g.cancel || g.status === "CANCEL") continue;
    if (g.home_team === code || g.away_team === code) return g;
  }
  return null;
}

/** Build the today's-game brief (win prob from the shared game model). */
function buildToday(
  g: GameRow | null,
  code: string,
  standings: Record<string, TeamStanding>,
  lgRg: number,
): ArticleToday | null {
  if (!g) return null;
  const home = g.home_team === code;
  const oppCode = home ? g.away_team : g.home_team;
  if (!oppCode) return null;
  const me = standings[code];
  const opp = standings[oppCode];
  if (!me || !opp) return null;

  const muMeHome = expectedRuns(me.rsRate, opp.raRate, lgRg, true);
  const muOppHome = expectedRuns(opp.rsRate, me.raRate, lgRg, true);
  const muMeAway = expectedRuns(me.rsRate, opp.raRate, lgRg, false);
  const muOppAway = expectedRuns(opp.rsRate, me.raRate, lgRg, false);

  let winProb: number, projFor: number, projAgainst: number;
  if (home) {
    winProb = winProbExact(muMeHome, muOppAway, DISPERSION_K) * 100;
    projFor = muMeHome;
    projAgainst = muOppAway;
  } else {
    winProb = (1 - winProbExact(muOppHome, muMeAway, DISPERSION_K)) * 100;
    projFor = muMeAway;
    projAgainst = muOppHome;
  }

  return {
    opp: TEAM_NAMES[oppCode as Franchise]?.ko ?? oppCode,
    oppCode,
    home,
    stadium: g.stadium,
    winProb: Number(winProb.toFixed(1)),
    projFor: Number(projFor.toFixed(1)),
    projAgainst: Number(projAgainst.toFixed(1)),
  };
}

function buildYesterday(g: GameRow | null, code: string): ArticleYesterday | null {
  if (!g || g.status !== "RESULT" || g.home_score == null || g.away_score == null) return null;
  const home = g.home_team === code;
  const oppCode = (home ? g.away_team : g.home_team) ?? "";
  const teamScore = home ? g.home_score : g.away_score;
  const oppScore = home ? g.away_score : g.home_score;
  const result: "W" | "L" | "T" = teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T";
  return {
    opp: TEAM_NAMES[oppCode as Franchise]?.ko ?? oppCode,
    oppCode,
    home,
    stadium: g.stadium,
    teamScore,
    oppScore,
    result,
  };
}

interface SnapTeam {
  ko?: string;
  playoff?: number;
}
interface SnapPlayer {
  name?: string;
  franchise_ko?: string;
  kind?: "bat" | "pit";
  war?: number | null;
  metric?: number | null;
  metric_label?: string;
}

function topPlayerFor(ko: string, players: SnapPlayer[]): ArticleTopPlayer | null {
  const p = players.find((x) => x.franchise_ko === ko && x.name);
  if (!p) return null;
  return {
    name: p.name as string,
    kind: p.kind === "pit" ? "pit" : "bat",
    war: p.war ?? null,
    metric: p.metric ?? null,
    metricLabel: p.metric_label ?? (p.kind === "pit" ? "ERA" : "wRC+"),
  };
}

export interface GenerateResult {
  articlesUpserted: number;
  date: string;
  models: Record<string, number>; // model id → count (observability)
}

/**
 * Generate + upsert today's article for every franchise. Best-effort per team;
 * one team's failure is logged and skipped, never aborting the rest.
 */
export async function generateDailyArticles(
  admin: SupabaseClient,
  season: number,
  opts: { runId?: string; now?: Date } = {},
): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const today = kstDateStr(now, 0);
  const yesterday = kstDateStr(now, -1);

  // 1) Games → standings + remaining schedule.
  const { data: gamesData, error: gamesErr } = await admin
    .from("kbo_games")
    .select("game_date, status, stadium, home_team, away_team, home_score, away_score, cancel, suspended")
    .eq("season", season);
  if (gamesErr) throw new Error(`articles: read games: ${gamesErr.message}`);
  const games = (gamesData ?? []) as GameRow[];

  const { standings, playedHome, lgRg, gb, leader, cut } = computeStandings(games, season);
  const remainingHome = remainingSchedule(playedHome);

  // 2) Conditional 가을야구 odds — one sim for all teams.
  const condTeams: CondTeam[] = FRANCHISES.map((code) => ({
    team: code,
    wins: standings[code].w,
    losses: standings[code].l,
    rsRate: standings[code].rsRate,
    raRate: standings[code].raRate,
  }));
  const cond = simulateRemaining(condTeams, remainingHome, { sims: SIM_DRAWS, seed: 42 });

  // 3) Optional context from the season snapshot (power odds, top players).
  const { data: snap } = await admin
    .from("kbo_sim_snapshots")
    .select("payload")
    .eq("season", season)
    .eq("kind", "season")
    .maybeSingle();
  const payload = (snap?.payload ?? {}) as { teams?: SnapTeam[]; players?: SnapPlayer[] };
  const snapTeams = payload.teams ?? [];
  const snapPlayers = payload.players ?? [];
  const powerByKo = new Map(snapTeams.map((t) => [t.ko, t.playoff ?? null]));

  // 4) Previous articles (for the day-over-day trend), latest per team before today.
  const { data: prev } = await admin
    .from("kbo_articles")
    .select("team, brief")
    .eq("season", season)
    .lt("article_date", today);
  const prevPlayoff = new Map<string, number>();
  for (const row of (prev ?? []) as { team: string; brief: { playoffPct?: number } | null }[]) {
    const v = row.brief?.playoffPct;
    if (typeof v === "number" && !prevPlayoff.has(row.team)) prevPlayoff.set(row.team, v);
  }

  const leaderSt = standings[leader];
  const cutSt = cut ? standings[cut] : null;

  // 5) Per team: brief → prose → render.
  const built = await Promise.all(
    FRANCHISES.map(async (code) => {
      try {
        const st = standings[code];
        const meta = TEAM_NAMES[code];
        const c = cond.get(code)!;

        const standingsBrief: ArticleStandings = {
          rank: st.rank,
          win: st.w,
          lose: st.l,
          draw: st.d,
          pct: st.w + st.l > 0 ? st.w / (st.w + st.l) : 0,
          gamesPlayed: st.gp,
          gamesRemaining: Math.max(0, GAMES_PER_SEASON - st.gp),
          gbLeader: Number(gb(st, leaderSt).toFixed(1)),
          gbCut: cutSt ? Number(gb(st, cutSt).toFixed(1)) : 0,
          inPlayoffSpot: st.rank <= 5,
          lastFive: null,
          streak: null,
        };

        const prevPct = prevPlayoff.get(code);
        const brief: ArticleBrief = {
          season,
          date: today,
          team: code,
          ko: meta.ko,
          en: meta.en,
          park: meta.park,
          standings: standingsBrief,
          yesterday: buildYesterday(findGameFor(games, yesterday, code), code),
          today: buildToday(findGameFor(games, today, code), code, standings, lgRg),
          playoffPct: c.playoff,
          firstPct: c.first,
          powerPlayoffPct: powerByKo.get(meta.ko) ?? null,
          trendPlayoff: prevPct != null ? Number((c.playoff - prevPct).toFixed(2)) : null,
          offRating: st.offRating,
          defRating: st.defRating,
          topPlayer: topPlayerFor(meta.ko, snapPlayers),
        };

        const { prose, model } = await writeArticleProse(brief);
        const { title, dek, teaser, bodyHtml } = renderArticle(brief, prose);
        return {
          season,
          team: code,
          article_date: today,
          title,
          dek,
          teaser,
          body_html: bodyHtml,
          brief,
          model,
          run_id: opts.runId ?? null,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } catch (e) {
        console.error(`[kbo-articles] ${code} failed:`, e instanceof Error ? e.message : e);
        return null;
      }
    }),
  );

  const rows = built.filter((r): r is NonNullable<typeof r> => r != null);
  if (rows.length > 0) {
    const { error } = await admin
      .from("kbo_articles")
      .upsert(rows, { onConflict: "season,team,article_date" });
    if (error) throw new Error(`articles: upsert: ${error.message}`);
  }

  const models: Record<string, number> = {};
  for (const r of rows) models[r.model] = (models[r.model] ?? 0) + 1;
  return { articlesUpserted: rows.length, date: today, models };
}
