/**
 * KBO postseason series reports — one report per SERIES per game day, plus a
 * wrap-up the morning after a series ends. Runs in /api/cron/kbo-daily (05:00
 * KST) right after ingest, so yesterday's postseason result is in kbo_games.
 *
 * Every number comes from the deterministic brief: regular-season standings
 * (seeds + shrunk run rates), the conditional postseason sim (postseason-sim.ts),
 * and today's game model. Yesterday's PRE-GAME prediction is read back from the
 * previous report's brief (written before first pitch → a frozen record), so the
 * review compares prediction vs result honestly. Prose (LLM or template) is
 * narrative only and HTML-escaped.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TEAM_NAMES, type Franchise } from "./franchise";
import { computeStandings, kstDateStr, type GameRow } from "./articles";
import { postseasonRound, ROUND_KO, type PostseasonRound } from "./postseason-ids";
import { gameWinProb, hostOf, simulatePostseason, type PsGame, type PsResult } from "./postseason-sim";
import { expectedRuns } from "./season-sim";
import { ARTICLE_STYLE } from "./article-template";
import { completeJson } from "@/lib/llm-gateway";
import { josa } from "./josa";
import { buildRoundPreviewBrief, renderRoundPreview, writeRoundPreviewProse, type RoundSide } from "./postseason-preview";

const MODEL = process.env.KBO_ARTICLE_MODEL ?? "anthropic/claude-haiku-4.5";
const SIMS = 40000;

const FORMAT_KO: Record<PostseasonRound, string> = {
  WC: "최대 2경기 · 4위 1승 어드밴티지",
  SPO: "5전 3선승제",
  PO: "5전 3선승제",
  KS: "7전 4선승제",
};

const ko = (c: string) => TEAM_NAMES[c as Franchise]?.ko ?? c;


// --------------------------------------------------------------------------- //
// Brief shapes.                                                               //
// --------------------------------------------------------------------------- //

export interface PsGamePred {
  homeWin: number; // %
  projHome: number;
  projAway: number;
}

export interface PsBrief {
  season: number;
  date: string;
  round: PostseasonRound;
  roundKo: string;
  format: string;
  higher: { code: string; ko: string; seed: number; wins: number; needs: number };
  lower: { code: string; ko: string; seed: number; wins: number; needs: number };
  winner: string | null; // series decided (by real results)
  review: {
    gameId: string;
    date: string;
    gameNo: number;
    home: string;
    away: string;
    homeKo: string;
    awayKo: string;
    homeScore: number;
    awayScore: number;
    winnerKo: string;
    pred: PsGamePred | null; // frozen pre-game prediction from the previous report
    hit: boolean | null;
  } | null;
  today: {
    gameId: string;
    gameNo: number;
    home: string;
    away: string;
    homeKo: string;
    awayKo: string;
    stadium: string | null;
    pred: PsGamePred;
  } | null;
  seriesProb: { higher: number; lower: number } | null; // null once decided
  bracket: { round: PostseasonRound; roundKo: string; higherKo: string; lowerKo: string | null; higherWins: number; lowerWins: number; winnerKo: string | null }[];
  teams: { code: string; ko: string; seed: number; reachKS: number; champion: number; alive: boolean }[];
  ratings: Record<string, { off: number; def: number; record: string }>;
}

export interface PsProse {
  lede: string;
  recap: string;
  preview: string;
  series: string;
  outlook: string;
}
const PROSE_KEYS: (keyof PsProse)[] = ["lede", "recap", "preview", "series", "outlook"];

export interface PsTeaser {
  kicker: string;
  heroLabel: string;
  seriesLine: string; // "LG 1승 · 두산 0승"
  today: string | null; // "오늘 2차전 · 잠실"
  result: string | null; // "어제 1차전 LG 5-3 두산"
}

// --------------------------------------------------------------------------- //
// Rendering.                                                                  //
// --------------------------------------------------------------------------- //

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const p1 = (v: number) => v.toFixed(1);
const md = (d: string) => d.slice(5).replace("-", "/");

function seriesLine(b: PsBrief): string {
  return `${b.higher.ko} ${b.higher.wins}승 · ${b.lower.ko} ${b.lower.wins}승`;
}

export function buildPsTitle(b: PsBrief): string {
  const tail = b.winner
    ? `${ko(b.winner)} 시리즈 승리`
    : b.today
      ? `${b.today.gameNo}차전 프리뷰`
      : "시리즈 현황";
  return `${b.roundKo} ${b.higher.ko} vs ${b.lower.ko} (${md(b.date)}) — ${tail}`;
}

export function buildPsTeaser(b: PsBrief): PsTeaser {
  return {
    kicker: `KBO 포스트시즌 · ${b.roundKo}`,
    heroLabel: b.winner ? "다음 라운드·우승 확률" : "시리즈 승리 확률",
    seriesLine: seriesLine(b),
    today: b.today ? `오늘 ${b.today.gameNo}차전${b.today.stadium ? ` · ${b.today.stadium}` : ""}` : null,
    result: b.review
      ? `${b.review.gameNo}차전 ${b.review.homeKo} ${b.review.homeScore}-${b.review.awayScore} ${b.review.awayKo}`
      : null,
  };
}

function renderPs(b: PsBrief, prose: PsProse) {
  const title = buildPsTitle(b);
  const dek = `${b.roundKo}(${b.format}) · ${seriesLine(b)}${b.winner ? ` · ${ko(b.winner)} 진출 확정` : ""}.`;
  const teaser = buildPsTeaser(b);

  const hero = b.seriesProb
    ? `<div class="hero"><div><div class="big">${p1(b.seriesProb.higher)}<span>%</span></div></div>
       <div class="htxt"><div class="t">${esc(b.higher.ko)} 시리즈 승리 확률 · 조건부 시뮬레이션</div>
       <div class="d">현재 ${esc(seriesLine(b))}. ${esc(b.lower.ko)} ${p1(b.seriesProb.lower)}%. 남은 경기를 ${SIMS / 10000}만 회 시뮬레이션한 값.</div></div></div>`
    : `<div class="hero"><div class="htxt"><div class="t">시리즈 종료</div>
       <div class="d">${esc(ko(b.winner!))}가 ${esc(seriesLine(b))}로 다음 라운드에 진출했다.</div></div></div>`;

  const review = b.review
    ? `<div class="today"><span class="chip">${b.review.gameNo}차전 · <b>${esc(b.review.homeKo)} ${b.review.homeScore}–${b.review.awayScore} ${esc(b.review.awayKo)}</b></span></div>
       ${b.review.pred
         ? `<div class="tablecard"><table><tbody>
             <tr><td>경기 전 예측 (${esc(b.review.homeKo)} 승리)</td><td class="r">${p1(b.review.pred.homeWin)}%</td></tr>
             <tr><td>경기 전 예상 스코어</td><td class="r">${b.review.pred.projHome.toFixed(1)}–${b.review.pred.projAway.toFixed(1)}</td></tr>
             <tr><td>실제 결과</td><td class="r">${esc(b.review.winnerKo)} 승 · ${b.review.hit ? "예측 적중" : "예측 빗나감"}</td></tr>
           </tbody></table></div>`
         : `<p class="fine">이 경기는 사전 예측 기록이 없다.</p>`}`
    : `<p class="fine">시리즈 첫 경기 당일이다.</p>`;

  const today = b.today
    ? `<div class="today">
        <span class="chip">${b.today.gameNo}차전 · 홈 <b>${esc(b.today.homeKo)}</b> vs <b>${esc(b.today.awayKo)}</b></span>
        <span class="chip">${esc(b.today.homeKo)} 승리 <b>${p1(b.today.pred.homeWin)}%</b></span>
        <span class="chip">예상 스코어 <b>${b.today.pred.projHome.toFixed(1)}–${b.today.pred.projAway.toFixed(1)}</b></span>
        ${b.today.stadium ? `<span class="chip">${esc(b.today.stadium)}</span>` : ""}
      </div>`
    : `<div class="today"><span class="chip">오늘 이 시리즈 경기 없음</span></div>`;

  const bracket = `<div class="tablecard"><table class="race">
    <thead><tr><th class="l">라운드</th><th class="l">대진</th><th>전적</th><th class="l">결과</th></tr></thead><tbody>
    ${b.bracket.map((r) => `<tr class="${r.round === b.round ? "me" : ""}"><td class="l">${esc(r.roundKo)}</td>
      <td class="l">${esc(r.higherKo)} vs ${esc(r.lowerKo ?? "미정")}</td><td>${r.higherWins}-${r.lowerWins}</td>
      <td class="l small">${r.winnerKo ? `${esc(r.winnerKo)} 진출` : "진행 전/중"}</td></tr>`).join("")}
    </tbody></table></div>`;

  const odds = `<div class="tablecard"><table class="race">
    <thead><tr><th class="c">시드</th><th class="l">팀</th><th>KS 진출</th><th>우승</th></tr></thead><tbody>
    ${b.teams.map((t) => `<tr class="${t.code === b.higher.code || t.code === b.lower.code ? "me" : ""}">
      <td class="c">${t.seed}</td><td class="l">${esc(t.ko)}${t.alive ? "" : " (탈락)"}</td>
      <td>${p1(t.reachKS)}%</td><td class="accent">${p1(t.champion)}%</td></tr>`).join("")}
    </tbody></table></div>`;

  const ratingRows = [b.higher.code, b.lower.code].map((c) => {
    const r = b.ratings[c];
    return `<tr><td>${esc(ko(c))} 정규시즌</td><td class="r">${esc(r.record)} · 공격 ${r.off.toFixed(0)} / 수비 ${r.def.toFixed(0)}</td></tr>`;
  }).join("");

  const bodyHtml = `${ARTICLE_STYLE}
<article class="kbo-article">
  <div class="brand">Blinkers · KBO 포스트시즌</div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(prose.lede)}</p>
  <div class="byline"><span><b>${esc(b.roundKo)}</b> ${esc(b.format)}</span><span>${esc(b.date)}</span><span>${esc(seriesLine(b))}</span></div>
  ${hero}
  <h2>Review · 어제</h2>
  <div class="h2title">지난 경기</div>
  ${review}
  <p>${esc(prose.recap)}</p>
  <h2>Preview · 오늘</h2>
  <div class="h2title">${b.today ? `${b.today.gameNo}차전 승부예측` : "다음 일정"}</div>
  ${today}
  <p>${esc(prose.preview)}</p>
  <h2>Series · 시리즈 판도</h2>
  <div class="h2title">포스트시즌 대진</div>
  ${bracket}
  <div class="tablecard"><table><tbody>${ratingRows}</tbody></table></div>
  <p>${esc(prose.series)}</p>
  <h2>Outlook · 우승 확률</h2>
  <div class="h2title">한국시리즈까지의 확률</div>
  ${odds}
  <p>${esc(prose.outlook)}</p>
  <div class="foot">
    <b>방법론 — 시뮬레이션 기반 예측.</b> 정규시즌 득점·실점력을 리그 평균으로 수축(0.7) 보정한 뒤, 음이항 득점 분포로
    경기별 승리 확률을 계산한다(홈 이점 반영, 선발 투수 매치업은 반영하지 않음). 이미 치른 포스트시즌 결과를 고정하고
    남은 시리즈를 와일드카드(4위 1승 어드밴티지)·준PO·PO(5전 3선승, 2-2-1)·한국시리즈(7전 4선승, 2-3-2) 규정대로
    <b>4만 회 몬테카를로</b>로 시뮬레이션했다. ‘경기 전 예측’은 전날 아침 발행된 리포트에 기록된 값이다.
    수치는 추정치이며 실제 결과를 보장하지 않는다. 생성 ${esc(b.date)}.
  </div>
</article>`;
  return { title, dek, teaser, bodyHtml };
}

// --------------------------------------------------------------------------- //
// Prose.                                                                      //
// --------------------------------------------------------------------------- //

const SYSTEM = [
  "당신은 KBO 포스트시즌을 데이터로 분석하는 전문 야구 칼럼니스트입니다.",
  "제공된 데이터 브리프(JSON)만을 근거로 한 시리즈의 리포트를 깊이 있는 한국어로 씁니다.",
  "규칙:",
  "1) 브리프의 숫자·사실(스코어·시리즈 전적·확률·예상 스코어)만 정확히 인용하세요. 브리프에 없는 선수 이름·선발 투수·홈런·적시타 같은 장면은 절대 지어내지 마세요.",
  "2) review.pred가 있으면 경기 전 예측과 실제 결과를 비교하세요(hit=true 적중, false 이변).",
  "3) 확률은 시뮬레이션 추정치임을 전제로 '모델은 ~로 본다' 식으로 서술. 과장·감탄사 자제.",
  "4) 분량: lede 2~3문장, recap·preview·series·outlook 각 3~5문장.",
  '5) JSON 객체 하나만 출력: {"lede","recap","preview","series","outlook"}.',
  "   lede = 시리즈 현재 상황 요약. recap = 어제 경기 결과와 의미(경기 없었으면 시리즈 흐름). preview = 오늘 경기 승부예측(없으면 다음 일정·대기 팀).",
  "   series = 시리즈 승리 확률과 대진표 맥락, 두 팀의 정규시즌 전력 비교. outlook = 한국시리즈 진출·우승 확률 전망.",
  "6) 인사말·설명·코드블록 없이 JSON만.",
].join("\n");

export function fallbackPsProse(b: PsBrief): PsProse {
  const line = seriesLine(b);
  const lede = b.winner
    ? `${josa(ko(b.winner), "이/가")} ${josa(b.roundKo, "을/를")} ${josa(line, "으로/로")} 마무리하며 다음 라운드에 올랐다.`
    : `${josa(b.roundKo, "은/는")} ${josa(line, "으로/로")} 진행 중이다. 모델은 ${b.higher.ko}의 시리즈 승리 확률을 ${p1(b.seriesProb?.higher ?? 0)}%로 본다.`;
  const recap = b.review
    ? `${b.review.gameNo}차전은 ${b.review.homeKo} ${b.review.homeScore}-${b.review.awayScore} ${b.review.awayKo}로 끝났고, ${josa(b.review.winnerKo, "이/가")} 승리했다.${b.review.pred ? ` 경기 전 모델은 ${b.review.homeKo}의 승리 확률을 ${p1(b.review.pred.homeWin)}%로 봤고 결과는 ${b.review.hit ? "예측과 일치했다" : "예측을 벗어났다"}.` : ""}`
    : `오늘은 시리즈의 첫 경기가 열리는 날이다.`;
  const preview = b.today
    ? `오늘 ${b.today.gameNo}차전은 ${b.today.homeKo}의 홈에서 열린다. 모델은 ${b.today.homeKo}의 승리 확률을 ${p1(b.today.pred.homeWin)}%, 예상 스코어를 ${b.today.pred.projHome.toFixed(1)}-${b.today.pred.projAway.toFixed(1)}로 추정한다.`
    : `이 시리즈의 오늘 경기는 없다.`;
  const series = b.seriesProb
    ? `${b.format} 시리즈에서 ${josa(b.higher.ko, "은/는")} ${b.higher.needs}승, ${josa(b.lower.ko, "은/는")} ${b.lower.needs}승이 더 필요하다. 남은 경기를 시뮬레이션하면 ${b.higher.ko} ${p1(b.seriesProb.higher)}%, ${b.lower.ko} ${p1(b.seriesProb.lower)}%다.`
    : `시리즈는 ${ko(b.winner!)}의 승리로 끝났다.`;
  const top = [...b.teams].filter((t) => t.alive).sort((x, y) => y.champion - x.champion)[0];
  const outlook = top ? `현재 우승 확률이 가장 높은 팀은 ${top.ko}(${p1(top.champion)}%)다. 남은 시리즈 결과에 따라 확률은 크게 움직일 수 있다.` : "";
  return { lede, recap, preview, series, outlook };
}

async function writePsProse(b: PsBrief): Promise<{ prose: PsProse; model: string }> {
  try {
    const parsed = await completeJson(MODEL, SYSTEM, `시리즈: ${b.roundKo} ${b.higher.ko} vs ${b.lower.ko}. 날짜: ${b.date}.\n브리프:\n${JSON.stringify(b)}`);
    if (parsed === null) return { prose: fallbackPsProse(b), model: "template" };
    const o = parsed as Record<string, unknown>;
    const out = {} as PsProse;
    for (const k of PROSE_KEYS) {
      if (typeof o[k] !== "string" || !(o[k] as string).trim()) throw new Error("malformed prose json");
      out[k] = (o[k] as string).trim();
    }
    return { prose: out, model: MODEL };
  } catch (e) {
    console.error("[kbo-postseason] prose fell back to template:", e instanceof Error ? e.message : e);
    return { prose: fallbackPsProse(b), model: "template" };
  }
}

// --------------------------------------------------------------------------- //
// Generator.                                                                  //
// --------------------------------------------------------------------------- //

export interface PsGenerateResult {
  started: boolean;
  articlesUpserted: number;
  rounds: string[];
  models: Record<string, number>;
}

export async function generatePostseasonArticles(
  admin: SupabaseClient,
  season: number,
  opts: { runId?: string; now?: Date } = {},
): Promise<PsGenerateResult> {
  const now = opts.now ?? new Date();
  const today = kstDateStr(now, 0);
  const yesterday = kstDateStr(now, -1);

  const { data, error } = await admin
    .from("kbo_games")
    .select("game_id, game_date, status, stadium, home_team, away_team, home_score, away_score, cancel, suspended")
    .eq("season", season);
  if (error) throw new Error(`postseason: read games: ${error.message}`);
  const all = (data ?? []) as (GameRow & { game_id: string })[];
  const post = all.filter((g) => postseasonRound(g.game_id));
  if (post.length === 0) return { started: false, articlesUpserted: 0, rounds: [], models: {} };

  // Seeds + ratings from the regular season.
  const { ranked, standings, lgRg } = computeStandings(all.filter((g) => !postseasonRound(g.game_id)), season, "9999-12-31");
  const seeds = ranked.slice(0, 5).map((r) => r.code as string);
  const wc = post.find((g) => postseasonRound(g.game_id) === "WC");
  if (wc?.home_team && wc.away_team) { seeds[3] = wc.home_team; seeds[4] = wc.away_team; } // real seeding wins ties
  const rates = seeds.map((t) => ({ team: t, rsRate: standings[t].rsRate, raRate: standings[t].raRate }));
  const rateOf = new Map(rates.map((r) => [r.team, r]));

  const finished = (beforeDate: string): PsGame[] =>
    post
      .filter((g) => g.status === "RESULT" && !g.cancel && g.home_score != null && g.away_score != null && (g.game_date ?? "") < beforeDate)
      .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""))
      .map((g) => ({ round: postseasonRound(g.game_id)!, home: g.home_team!, away: g.away_team!, homeScore: g.home_score!, awayScore: g.away_score! }));

  const sim: PsResult = simulatePostseason(seeds, rates, lgRg, finished(today), { sims: SIMS });

  const predOf = (home: string, away: string): PsGamePred => ({
    homeWin: Number((100 * gameWinProb(rateOf.get(home)!, rateOf.get(away)!, lgRg)).toFixed(1)),
    projHome: Number(expectedRuns(rateOf.get(home)!.rsRate, rateOf.get(away)!.raRate, lgRg, true).toFixed(1)),
    projAway: Number(expectedRuns(rateOf.get(away)!.rsRate, rateOf.get(home)!.raRate, lgRg, false).toFixed(1)),
  });

  // Previous reports → yesterday's frozen pre-game predictions.
  const { data: prevData } = await admin.from("kbo_postseason_articles").select("round, brief")
    .eq("season", season).lt("article_date", today).order("article_date", { ascending: false }).limit(40);
  const frozen = new Map<string, PsGamePred>();
  for (const r of (prevData ?? []) as { brief: PsBrief }[]) {
    const t = r.brief?.today;
    if (t && !frozen.has(t.gameId)) frozen.set(t.gameId, t.pred);
  }

  const bracket = sim.series.map((s) => ({
    round: s.round, roundKo: ROUND_KO[s.round], higherKo: ko(s.higher!), lowerKo: s.lower ? ko(s.lower) : null,
    higherWins: s.higherWins, lowerWins: s.lowerWins, winnerKo: s.winner ? ko(s.winner) : null,
  }));
  const teams = sim.teams.map((t) => ({ code: t.team, ko: ko(t.team), seed: t.seed, reachKS: t.reachKS, champion: t.champion, alive: t.alive }));
  const ratings: PsBrief["ratings"] = {};
  for (const t of seeds) {
    const st = standings[t];
    ratings[t] = { off: st.offRating, def: st.defRating, record: `${st.w}승 ${st.l}패${st.d ? ` ${st.d}무` : ""}` };
  }

  const rows = [];
  const models: Record<string, number> = {};

  // Round previews: the morning BEFORE a round's first game, once both sides are known.
  const { data: pvData } = await admin.from("kbo_postseason_articles").select("round")
    .eq("season", season).eq("brief->>kind", "round-preview");
  const previewed = new Set(((pvData ?? []) as { round: string }[]).map((r) => r.round));
  const regular = all.filter((g) => !postseasonRound(g.game_id));
  const sideOf = (c: string): RoundSide => {
    const st = standings[c];
    return {
      code: c, ko: ko(c), seed: seeds.indexOf(c) + 1, record: ratings[c].record,
      off: st.offRating, def: st.defRating, runsFor: st.rsRate, runsAgainst: st.raRate,
    };
  };
  for (const s of sim.series) {
    if (!s.higher || !s.lower || s.winner || s.gamesPlayed > 0 || previewed.has(s.round)) continue;
    const dates = post
      .filter((g) => postseasonRound(g.game_id) === s.round && !g.cancel && g.game_date)
      .map((g) => g.game_date!)
      .sort();
    if (!dates.length || dates[0] <= today) continue; // starts today/unscheduled → the game-day report covers it
    const h2h = { higherWins: 0, lowerWins: 0, ties: 0 };
    for (const g of regular) {
      if (g.status !== "RESULT" || g.home_score == null || g.away_score == null) continue;
      const pair = [g.home_team, g.away_team];
      if (!pair.includes(s.higher) || !pair.includes(s.lower)) continue;
      const hiScore = g.home_team === s.higher ? g.home_score : g.away_score;
      const loScore = g.home_team === s.higher ? g.away_score : g.home_score;
      if (hiScore > loScore) h2h.higherWins++; else if (loScore > hiScore) h2h.lowerWins++; else h2h.ties++;
    }
    const brief = buildRoundPreviewBrief({
      season, date: today, round: s.round, higher: sideOf(s.higher), lower: sideOf(s.lower), seeds,
      pHostWins: (host, guest) => gameWinProb(rateOf.get(host)!, rateOf.get(guest)!, lgRg),
      gameDates: [...new Set(dates)], h2h, teams: teams.map(({ alive: _a, ...t }) => t),
    });
    const { prose, model } = await writeRoundPreviewProse(brief);
    const r = renderRoundPreview(brief, prose);
    models[model] = (models[model] ?? 0) + 1;
    rows.push({
      season, round: s.round, article_date: today, higher_team: s.higher, lower_team: s.lower,
      review_game_id: null, today_game_id: null,
      title: r.title, dek: r.dek, teaser: r.teaser, body_html: r.bodyHtml, brief, model, run_id: opts.runId ?? null,
      published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }
  for (const s of sim.series) {
    if (!s.higher || !s.lower) continue;
    const roundGames = post.filter((g) => postseasonRound(g.game_id) === s.round && !g.cancel);
    const yGame = roundGames.find((g) => g.game_date === yesterday && g.status === "RESULT" && g.home_score != null);
    const tGame = roundGames.find((g) => g.game_date === today && g.status === "BEFORE");
    if (!yGame && !tGame) continue;
    // Today's game only belongs to this series if the series is still open.
    const tLive = tGame && !s.winner ? tGame : undefined;
    if (!yGame && !tLive) continue;

    const decisiveBefore = (d: string) => roundGames.filter((g) => g.status === "RESULT" && g.home_score != null && g.home_score !== g.away_score && (g.game_date ?? "") < d).length;
    const hostToday = tLive ? tLive.home_team! : null;
    const hNeeds = s.higherNeeds - s.higherWins;
    const lNeeds = s.lowerNeeds - s.lowerWins;

    let review: PsBrief["review"] = null;
    if (yGame) {
      const hs = yGame.home_score!, as = yGame.away_score!;
      const pred = frozen.get(yGame.game_id) ?? null;
      const homeWon = hs > as;
      review = {
        gameId: yGame.game_id, date: yGame.game_date!, gameNo: decisiveBefore(yesterday) + 1,
        home: yGame.home_team!, away: yGame.away_team!, homeKo: ko(yGame.home_team!), awayKo: ko(yGame.away_team!),
        homeScore: hs, awayScore: as, winnerKo: hs === as ? "무승부" : ko(homeWon ? yGame.home_team! : yGame.away_team!),
        pred, hit: pred && hs !== as ? (pred.homeWin >= 50) === homeWon : null,
      };
    }
    const brief: PsBrief = {
      season, date: today, round: s.round, roundKo: ROUND_KO[s.round], format: FORMAT_KO[s.round],
      higher: { code: s.higher, ko: ko(s.higher), seed: seeds.indexOf(s.higher) + 1, wins: s.higherWins, needs: Math.max(hNeeds, 0) },
      lower: { code: s.lower, ko: ko(s.lower), seed: seeds.indexOf(s.lower) + 1, wins: s.lowerWins, needs: Math.max(lNeeds, 0) },
      winner: s.winner,
      review,
      today: tLive ? {
        gameId: tLive.game_id, gameNo: decisiveBefore(today) + 1,
        home: hostToday!, away: tLive.away_team!, homeKo: ko(hostToday!), awayKo: ko(tLive.away_team!),
        stadium: tLive.stadium ?? null, pred: predOf(hostToday!, tLive.away_team!),
      } : null,
      seriesProb: s.winner ? null : { higher: s.pHigher, lower: Number((100 - s.pHigher).toFixed(1)) },
      bracket, teams, ratings,
    };
    const { prose, model } = await writePsProse(brief);
    const r = renderPs(brief, prose);
    models[model] = (models[model] ?? 0) + 1;
    rows.push({
      season, round: s.round, article_date: today, higher_team: s.higher, lower_team: s.lower,
      review_game_id: yGame?.game_id ?? null, today_game_id: tLive?.game_id ?? null,
      title: r.title, dek: r.dek, teaser: r.teaser, body_html: r.bodyHtml, brief, model, run_id: opts.runId ?? null,
      published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error: upErr } = await admin.from("kbo_postseason_articles").upsert(rows, { onConflict: "season,round,article_date" });
    if (upErr) throw new Error(`postseason articles upsert: ${upErr.message}`);
  }
  return { started: true, articlesUpserted: rows.length, rounds: rows.map((r) => r.round), models };
}

// Exposed for tests.
export { renderPs, hostOf, josa };
