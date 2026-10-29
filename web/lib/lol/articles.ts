/**
 * Worlds match-day reports — one per MATCH DAY (KST), published by the first
 * cron run after that day's last series is final, so readers get it the same
 * morning. Contents: review of the day vs the FROZEN pre-match predictions
 * (lol_predictions), preview of the next match day, and the conditional
 * tournament odds (worlds-sim.ts).
 *
 * A report is refreshed by later runs only while the next match day hasn't
 * started and more of its pairings have since been drawn (Swiss pairings land a
 * few hours after a round ends). Every number comes from the brief; prose (LLM
 * or template) is narrative only and HTML-escaped.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTICLE_STYLE } from "@/lib/kbo/article-template";
import { josa } from "@/lib/kbo/josa";
import { completeJson } from "@/lib/llm-gateway";
import { kstDate } from "@/lib/soccer/predictions";
import type { LolMatchRow } from "./data";
import type { LolFit } from "./model";
import { mapWinProb, ratingOf } from "./model";
import { MODEL_VERSION, WORLDS_LEAGUE_ID, WORLDS_SEASON, predictSeries } from "./pipeline";
import { simulateWorlds, stageOf, swissRecords } from "./worlds-sim";

const MODEL = process.env.LOL_ARTICLE_MODEL ?? process.env.KBO_ARTICLE_MODEL ?? "anthropic/claude-haiku-4.5";
const SIMS = 20000;
const EVENT = "worlds";

// --------------------------------------------------------------------------- //
// Brief.                                                                      //
// --------------------------------------------------------------------------- //

export interface LolSeriesLine {
  gameId: string;
  stage: string;          // '스위스 3R'
  bestOf: number;
  home: string;           // acronym
  away: string;
  homeName: string;
  awayName: string;
  startKst: string;       // 'HH:MM'
}

export interface LolReviewLine extends LolSeriesLine {
  homeScore: number;
  awayScore: number;
  winner: string;
  pred: { pHome: number; likely: string; retro: boolean } | null; // frozen (retro = walk-forward reconstruction); pHome in %
  hit: boolean | null;
}

export interface LolPreviewLine extends LolSeriesLine {
  pHome: number;          // %
  pMap: number;           // % (one map)
  scores: { score: string; p: number }[]; // home-first, %
  homeRecord: string | null;
  awayRecord: string | null;
}

export interface LolBrief {
  kind: "worlds-day";
  season: number;
  date: string;            // match day reviewed (KST)
  stage: string;           // stage(s) of that day
  review: LolReviewLine[];
  dayHits: { hit: number; n: number };
  totalHits: { hit: number; n: number };
  next: {
    date: string;
    stage: string;
    known: LolPreviewLine[];
    tbd: number;           // series still waiting for the draw
  } | null;
  odds: { team: string; name: string; record: string; alive: boolean; advance: number; semis: number; final: number; champion: number }[];
  ratings: { team: string; name: string; elo: number }[];
}

export interface LolProse { lede: string; review: string; preview: string; outlook: string }
const PROSE_KEYS: (keyof LolProse)[] = ["lede", "review", "preview", "outlook"];

export interface LolTeaser {
  kicker: string;
  seriesLine: string;      // '예측 적중 3/4'
  result: string | null;   // 'GEN 2-1 LYON 외 3경기'
  today: string | null;    // '다음 10/27 · CFO vs T1 외 3경기'
}

// --------------------------------------------------------------------------- //
// Helpers.                                                                    //
// --------------------------------------------------------------------------- //

const pct = (x: number) => Number((100 * x).toFixed(1));
const p1 = (v: number) => v.toFixed(1);
const md = (d: string) => d.slice(5).replace("-", "/");
const kstHm = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(11, 16);
const dayOf = (m: LolMatchRow) => kstDate(new Date(m.start_at));
const known = (m: LolMatchRow) => m.home_team !== "TBD" && m.away_team !== "TBD";
const finished = (m: LolMatchRow) => m.status === "RESULT" && m.home_score !== m.away_score;
/** Display Elo: map log-odds → base-10/400 scale around 1500. */
const elo = (r: number) => Math.round(1500 + (400 / Math.LN10) * r);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stageLabel(ms: LolMatchRow[]): string {
  return [...new Set(ms.map((m) => m.title ?? "").filter(Boolean))].join(" · ");
}

function line(m: LolMatchRow): LolSeriesLine {
  return {
    gameId: m.game_id, stage: m.title ?? "", bestOf: m.best_of,
    home: m.home_code ?? m.home_team, away: m.away_code ?? m.away_team,
    homeName: m.home_name ?? m.home_code ?? m.home_team, awayName: m.away_name ?? m.away_code ?? m.away_team,
    startKst: kstHm(m.start_at),
  };
}

// --------------------------------------------------------------------------- //
// Rendering.                                                                  //
// --------------------------------------------------------------------------- //

export function buildLolTitle(b: LolBrief): string {
  const head = `롤드컵 ${b.stage} (${md(b.date)}) 리뷰`;
  if (!b.next) return `${head} — 대회 결산`;
  const first = b.next.known[0];
  if (!first) return `${head} — ${b.next.stage} 전망`;
  const more = b.next.known.length + b.next.tbd - 1;
  return `${head} — ${first.home} vs ${first.away}${more > 0 ? ` 외 ${more}경기` : ""} 승부예측`;
}

export function buildLolTeaser(b: LolBrief): LolTeaser {
  const r0 = b.review[0];
  const n0 = b.next?.known[0];
  return {
    kicker: `롤드컵 ${WORLDS_SEASON} · ${b.stage}`,
    seriesLine: b.dayHits.n ? `예측 적중 ${b.dayHits.hit}/${b.dayHits.n}` : `${b.review.length}경기 결과`,
    result: r0 ? `${r0.home} ${r0.homeScore}-${r0.awayScore} ${r0.away}${b.review.length > 1 ? ` 외 ${b.review.length - 1}경기` : ""}` : null,
    today: b.next
      ? `다음 ${md(b.next.date)} · ${n0 ? `${n0.home} vs ${n0.away}` : b.next.stage}${n0 && b.next.known.length + b.next.tbd > 1 ? ` 외 ${b.next.known.length + b.next.tbd - 1}경기` : ""}`
      : null,
  };
}

function renderLol(b: LolBrief, prose: LolProse) {
  const title = buildLolTitle(b);
  const teaser = buildLolTeaser(b);
  const dek = `${b.stage} ${b.review.length}경기 결과${b.dayHits.n ? `와 예측 검증(${b.dayHits.hit}/${b.dayHits.n} 적중)` : ""}` +
    (b.next ? `, ${md(b.next.date)} ${b.next.stage} 승부예측과 우승 확률.` : ", 최종 결산.");

  const reviewRows = b.review.map((r) => `<tr>
      <td class="l">${esc(r.stage)} · Bo${r.bestOf}</td>
      <td class="l"><b>${esc(r.home)}</b> ${r.homeScore}–${r.awayScore} <b>${esc(r.away)}</b></td>
      <td>${r.pred ? `${esc(r.home)} ${p1(r.pred.pHome)}%${r.pred.retro ? "*" : ""}` : "—"}</td>
      <td class="l small">${r.hit == null ? "기록 없음" : r.hit ? "적중" : "이변"}</td></tr>`).join("");
  const review = `<div class="tablecard"><table class="race">
    <thead><tr><th class="l">단계</th><th class="l">결과</th><th>경기 전 예측</th><th class="l">판정</th></tr></thead>
    <tbody>${reviewRows}</tbody></table></div>
    <p class="fine">대회 누적 예측 적중 ${b.totalHits.hit}/${b.totalHits.n}${b.totalHits.n ? ` (${p1((100 * b.totalHits.hit) / b.totalHits.n)}%)` : ""}. ‘경기 전 예측’은 시리즈 시작 전에 저장된 값이다.${b.review.some((r) => r.pred?.retro) ? " * 표시는 서비스 시작 전 경기로, 그 경기 이전 데이터만으로 사후 재현한 예측이다." : ""}</p>`;

  const preview = b.next
    ? b.next.known.map((s) => `<div class="today">
        <span class="chip">${esc(s.startKst)} · ${esc(s.stage)} · Bo${s.bestOf}</span>
        <span class="chip"><b>${esc(s.home)}</b>${s.homeRecord ? ` (${s.homeRecord})` : ""} vs <b>${esc(s.away)}</b>${s.awayRecord ? ` (${s.awayRecord})` : ""}</span>
        <span class="chip">${esc(s.home)} 승리 <b>${p1(s.pHome)}%</b></span>
        <span class="chip">세트당 ${p1(s.pMap)}%</span>
        ${s.bestOf > 1 ? `<span class="chip">예상 스코어 ${s.scores.slice(0, 3).map((x) => `${x.score} ${p1(x.p)}%`).join(" · ")}</span>` : ""}
      </div>`).join("") + (b.next.tbd ? `<p class="fine">나머지 ${b.next.tbd}경기는 대진 추첨 전이다. 추첨이 나오면 리포트가 갱신된다.</p>` : "")
    : `<p class="fine">남은 경기가 없다.</p>`;

  const odds = `<div class="tablecard"><table class="race">
    <thead><tr><th class="l">팀</th><th class="c">스위스</th><th>8강</th><th>4강</th><th>결승</th><th>우승</th></tr></thead><tbody>
    ${b.odds.map((t) => `<tr class="${b.next?.known.some((s) => s.home === t.team || s.away === t.team) ? "me" : ""}">
      <td class="l">${esc(t.team)}${t.alive ? "" : " (탈락)"}</td><td class="c">${t.record}</td>
      <td>${p1(t.advance)}%</td><td>${p1(t.semis)}%</td><td>${p1(t.final)}%</td><td class="accent">${p1(t.champion)}%</td></tr>`).join("")}
    </tbody></table></div>`;

  const ratings = `<div class="tablecard"><table><tbody>
    ${b.ratings.slice(0, 8).map((r, i) => `<tr><td>${i + 1}. ${esc(r.team)} <span class="small">${esc(r.name)}</span></td><td class="r">${r.elo}</td></tr>`).join("")}
    </tbody></table></div>`;

  const hero = b.odds[0]
    ? `<div class="hero"><div><div class="big">${p1(b.odds[0].champion)}<span>%</span></div></div>
       <div class="htxt"><div class="t">${esc(b.odds[0].team)} 우승 확률 · 조건부 시뮬레이션</div>
       <div class="d">지금까지의 실제 결과를 고정하고 남은 스위스 스테이지와 녹아웃을 ${SIMS / 10000}만 회 시뮬레이션한 값. 2위 ${esc(b.odds[1]?.team ?? "-")} ${p1(b.odds[1]?.champion ?? 0)}%.</div></div></div>`
    : "";

  const bodyHtml = `${ARTICLE_STYLE}
<article class="kbo-article">
  <div class="brand">Blinkers · 롤드컵 ${WORLDS_SEASON}</div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(prose.lede)}</p>
  <div class="byline"><span><b>${esc(b.stage)}</b></span><span>${esc(b.date)}</span><span>${esc(teaser.seriesLine)}</span></div>
  ${hero}
  <h2>Review · 결과</h2>
  <div class="h2title">${md(b.date)} 경기 결과와 예측 검증</div>
  ${review}
  <p>${esc(prose.review)}</p>
  <h2>Preview · 다음 경기</h2>
  <div class="h2title">${b.next ? `${md(b.next.date)} ${esc(b.next.stage)} 승부예측` : "대회 종료"}</div>
  ${preview}
  <p>${esc(prose.preview)}</p>
  <h2>Outlook · 우승 확률</h2>
  <div class="h2title">스위스 통과 · 4강 · 결승 · 우승 확률</div>
  ${odds}
  <p>${esc(prose.outlook)}</p>
  <div class="h2title">파워 레이팅 (Elo 환산)</div>
  ${ratings}
  <div class="foot">
    <b>방법론 — 세트 단위 레이팅 모델.</b> 2026 시즌 LCK·LPL·LEC·LCS·LCP·CBLOL 정규리그와 MSI·롤드컵의 모든 시리즈를
    세트 스코어로 학습한 Bradley–Terry 모델(최근 경기 가중, 반감기 240일)에 리그별 오프셋을 더해 지역 간 격차를 반영한다.
    세트 승률로 Bo1·Bo3·Bo5 시리즈 승률과 스코어 분포를 정확히 계산하고, 실제 결과를 고정한 채 남은 스위스 스테이지
    (같은 전적끼리·재대결 회피)와 8강 대진 추첨(3-0 팀 vs 3-2 팀, 3-0 팀 반대 시드)·녹아웃을 <b>${SIMS / 10000}만 회 몬테카를로</b>로
    시뮬레이션했다. 진영·밴픽·패치·선수 교체는 반영하지 않는다. 수치는 추정치이며 실제 결과를 보장하지 않는다.
    모델 ${MODEL_VERSION} · 생성 ${esc(b.date)}.
  </div>
</article>`;
  return { title, dek, teaser, bodyHtml };
}

// --------------------------------------------------------------------------- //
// Prose.                                                                      //
// --------------------------------------------------------------------------- //

const SYSTEM = [
  "당신은 리그 오브 레전드 e스포츠를 데이터로 분석하는 칼럼니스트입니다.",
  "제공된 데이터 브리프(JSON)만을 근거로 롤드컵 하루치 리포트를 깊이 있는 한국어로 씁니다.",
  "규칙:",
  "1) 브리프의 숫자·사실(세트 스코어·확률·전적·레이팅)만 정확히 인용하세요. 선수 이름·챔피언·밴픽·킬 스코어·명장면은 브리프에 없으므로 절대 지어내지 마세요.",
  "2) 팀은 약칭(GEN, T1 등)으로 부르세요. review의 pred가 있으면 경기 전 예측과 실제 결과를 비교(hit=true 적중, false 이변). pred.retro=true는 서비스 시작 전 경기를 그 이전 데이터로 사후 재현한 예측이니 '사후 재현 기준'임을 밝히세요.",
  "3) 확률은 시뮬레이션 추정치임을 전제로 '모델은 ~로 본다' 식으로 서술. 과장·감탄사 자제.",
  "4) 분량: lede 2~3문장, review·preview·outlook 각 3~6문장.",
  '5) JSON 객체 하나만 출력: {"lede","review","preview","outlook"}.',
  "   lede = 하루 요약. review = 경기 결과와 예측 검증·의미. preview = 다음 경기일 승부예측(대진 미정이면 그 사실). outlook = 스위스 통과·우승 확률 판도.",
  "6) 인사말·설명·코드블록 없이 JSON만.",
].join("\n");

export function fallbackLolProse(b: LolBrief): LolProse {
  const upsets = b.review.filter((r) => r.hit === false);
  const lede = `롤드컵 ${b.stage} ${b.review.length}경기가 끝났다.` +
    (b.dayHits.n ? ` 모델의 경기 전 예측은 ${b.dayHits.n}경기 중 ${b.dayHits.hit}경기를 맞혔다.` : "");
  const review = b.review.map((r) => `${r.home} ${r.homeScore}-${r.awayScore} ${r.away}`).join(", ") + "." +
    (!b.dayHits.n ? " 이 경기들은 사전 예측 기록이 없다."
      : upsets.length ? ` 모델 예상을 뒤집은 경기는 ${upsets.map((r) => `${josa(r.winner, "이/가")} 이긴 ${r.home}-${r.away}전`).join(", ")}이었다.`
      : " 모델이 우세로 본 팀이 모두 이겼다.");
  const preview = b.next
    ? b.next.known.length
      ? b.next.known.map((s) => `${s.home}-${s.away}(Bo${s.bestOf})은 ${s.home} ${p1(s.pHome)}%`).join(", ") + "로 모델은 본다." +
        (b.next.tbd ? ` 나머지 ${b.next.tbd}경기는 대진 추첨 전이다.` : "")
      : `${md(b.next.date)} ${b.next.stage} 대진은 아직 추첨 전이다.`
    : "모든 일정이 끝났다.";
  const top = b.odds.filter((t) => t.alive).slice(0, 3);
  const outlook = top.length
    ? `우승 확률은 ${top.map((t) => `${t.team} ${p1(t.champion)}%`).join(", ")} 순이다. 남은 결과에 따라 확률은 크게 움직일 수 있다.`
    : "";
  return { lede, review, preview, outlook };
}

async function writeProse(b: LolBrief): Promise<{ prose: LolProse; model: string }> {
  try {
    const parsed = await completeJson(MODEL, SYSTEM, `롤드컵 ${b.stage} ${b.date}.\n브리프:\n${JSON.stringify(b)}`);
    if (parsed === null) return { prose: fallbackLolProse(b), model: "template" };
    const o = parsed as Record<string, unknown>;
    const out = {} as LolProse;
    for (const k of PROSE_KEYS) {
      if (typeof o[k] !== "string" || !(o[k] as string).trim()) throw new Error("malformed prose json");
      out[k] = (o[k] as string).trim();
    }
    return { prose: out, model: MODEL };
  } catch (e) {
    console.error("[lol-articles] prose fell back to template:", e instanceof Error ? e.message : e);
    return { prose: fallbackLolProse(b), model: "template" };
  }
}

// --------------------------------------------------------------------------- //
// Brief builder + generator.                                                  //
// --------------------------------------------------------------------------- //

type FrozenPred = { game_id: string; p_home: number; scores: { a: number; b: number; p: number }[]; model: string };

/**
 * The match day to report on: the latest KST day (≤ today) whose series are all
 * final. Null while the current day is still being played.
 */
export function reportDay(wc: LolMatchRow[], now: Date): string | null {
  const today = kstDate(now);
  const days = [...new Set(wc.filter(known).map(dayOf))].filter((d) => d <= today).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const ms = wc.filter((m) => dayOf(m) === days[i] && known(m));
    const begun = ms.filter((m) => m.status !== "BEFORE" || Date.parse(m.start_at) <= now.getTime());
    if (begun.length === 0) continue; // later today, not started yet → the previous day is still current
    return ms.every(finished) ? days[i] : null; // in progress → wait for its last series
  }
  return null;
}

export function buildLolBrief(wc: LolMatchRow[], fit: LolFit, frozen: Map<string, FrozenPred>, day: string): LolBrief {
  const pMap = (a: string, b: string) => mapWinProb(fit, a, b);
  const sim = simulateWorlds(wc, pMap, { sims: SIMS });
  const rec = swissRecords(wc);
  const codeOf = new Map<string, { code: string; name: string }>();
  for (const m of wc) {
    if (m.home_team !== "TBD") codeOf.set(m.home_team, { code: m.home_code ?? m.home_team, name: m.home_name ?? "" });
    if (m.away_team !== "TBD") codeOf.set(m.away_team, { code: m.away_code ?? m.away_team, name: m.away_name ?? "" });
  }
  const recStr = (id: string) => {
    const r = rec.get(id);
    return r ? `${r.w}-${r.l}` : null;
  };

  const dayMs = wc.filter((m) => dayOf(m) === day && known(m) && finished(m));
  const review: LolReviewLine[] = dayMs.map((m) => {
    const fp = frozen.get(m.game_id);
    const homeWon = m.home_score > m.away_score;
    const likely = fp ? [...fp.scores].sort((x, y) => y.p - x.p)[0] : null;
    return {
      ...line(m), homeScore: m.home_score, awayScore: m.away_score,
      winner: homeWon ? (m.home_code ?? m.home_team) : (m.away_code ?? m.away_team),
      pred: fp ? { pHome: pct(fp.p_home), likely: likely ? `${likely.a}-${likely.b}` : "", retro: fp.model.endsWith("-walkforward") } : null,
      hit: fp ? (fp.p_home >= 0.5) === homeWon : null,
    };
  });
  const hits = (rs: { hit: boolean | null }[]) => ({ hit: rs.filter((r) => r.hit).length, n: rs.filter((r) => r.hit != null).length });
  const allDone = wc.filter((m) => known(m) && finished(m) && dayOf(m) <= day).map((m) => {
    const fp = frozen.get(m.game_id);
    return { hit: fp ? (fp.p_home >= 0.5) === m.home_score > m.away_score : null };
  });

  const nextDay = [...new Set(wc.map(dayOf))].filter((d) => d > day).sort()[0];
  let next: LolBrief["next"] = null;
  if (nextDay) {
    const ms = wc.filter((m) => dayOf(m) === nextDay).sort((a, b) => a.start_at.localeCompare(b.start_at));
    next = {
      date: nextDay,
      stage: stageLabel(ms),
      tbd: ms.filter((m) => !known(m)).length,
      known: ms.filter(known).map((m) => {
        const p = predictSeries(fit, m.home_team, m.away_team, m.best_of);
        return {
          ...line(m), pHome: pct(p.pHome), pMap: pct(p.pMap),
          scores: [...p.scores].sort((x, y) => y.p - x.p).map((s) => ({ score: `${s.a}-${s.b}`, p: pct(s.p) })),
          homeRecord: stageOf(m.title).kind === "swiss" ? recStr(m.home_team) : null,
          awayRecord: stageOf(m.title).kind === "swiss" ? recStr(m.away_team) : null,
        };
      }),
    };
  }

  const odds = sim.teams.map((t) => ({
    team: codeOf.get(t.team)?.code ?? t.team, name: codeOf.get(t.team)?.name ?? "",
    record: `${t.wins}-${t.losses}`, alive: t.alive,
    advance: t.advance, semis: t.semis, final: t.final, champion: t.champion,
  }));
  const ratings = sim.teams
    .map((t) => ({ team: codeOf.get(t.team)?.code ?? t.team, name: codeOf.get(t.team)?.name ?? "", elo: elo(ratingOf(fit, t.team)) }))
    .sort((a, b) => b.elo - a.elo);

  return {
    kind: "worlds-day", season: WORLDS_SEASON, date: day, stage: stageLabel(dayMs),
    review, dayHits: hits(review), totalHits: hits(allDone), next, odds, ratings,
  };
}

export interface LolArticleResult {
  day: string | null;
  action: "published" | "refreshed" | "unchanged" | "waiting";
  model?: string;
}

export async function generateLolArticle(
  admin: SupabaseClient,
  rows: LolMatchRow[],
  fit: LolFit,
  opts: { now?: Date; runId?: string; force?: boolean } = {},
): Promise<LolArticleResult> {
  const now = opts.now ?? new Date();
  const wc = rows.filter((m) => m.league_id === WORLDS_LEAGUE_ID);
  const day = reportDay(wc, now);
  if (!day) return { day: null, action: "waiting" };

  const { data: existing } = await admin.from("lol_articles").select("brief")
    .eq("season", WORLDS_SEASON).eq("event", EVENT).eq("article_date", day).maybeSingle();
  const prevBrief = (existing?.brief ?? null) as LolBrief | null;
  const nextMs = wc.filter((m) => dayOf(m) > day);
  const nextDay = nextMs.map(dayOf).sort()[0];
  const nextStarted = nextMs.some((m) => dayOf(m) === nextDay && (m.status !== "BEFORE" || Date.parse(m.start_at) <= now.getTime()));
  const knownNext = nextMs.filter((m) => dayOf(m) === nextDay && known(m)).length;
  if (prevBrief && !opts.force) {
    // Refresh only to fill in newly drawn pairings, and never once the next day is under way.
    if (nextStarted || knownNext <= (prevBrief.next?.known.length ?? 0)) return { day, action: "unchanged" };
  }

  const { data: fp, error: fpErr } = await admin.from("lol_predictions").select("game_id, p_home, scores, model")
    .eq("league_id", WORLDS_LEAGUE_ID);
  if (fpErr) throw new Error(`lol_predictions read: ${fpErr.message}`);
  const frozen = new Map(((fp ?? []) as FrozenPred[]).map((r) => [r.game_id, r]));

  const brief = buildLolBrief(wc, fit, frozen, day);
  const { prose, model } = await writeProse(brief);
  const r = renderLol(brief, prose);
  const teams = [...new Set([...brief.review.flatMap((x) => [x.home, x.away]), ...(brief.next?.known ?? []).flatMap((x) => [x.home, x.away])])];
  const { error } = await admin.from("lol_articles").upsert({
    season: WORLDS_SEASON, event: EVENT, article_date: day, teams,
    title: r.title, dek: r.dek, teaser: r.teaser, body_html: r.bodyHtml, brief, model, run_id: opts.runId ?? null,
    updated_at: new Date().toISOString(), ...(prevBrief ? {} : { published_at: new Date().toISOString() }),
  }, { onConflict: "season,event,article_date" });
  if (error) throw new Error(`lol_articles upsert: ${error.message}`);
  return { day, action: prevBrief ? "refreshed" : "published", model };
}

// Exposed for tests.
export { renderLol };
