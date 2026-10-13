/**
 * KBO postseason ROUND PREVIEW — one report per series, published the morning
 * BEFORE the round's first game (as soon as both sides are known). Lives in
 * kbo_postseason_articles next to the per-game-day series reports, tagged
 * brief.kind = "round-preview"; the same newest-1-per-series paywall applies,
 * so the preview turns free once game 1's report is out.
 *
 * Numbers: exact series-score distribution + per-game win probabilities
 * (postseason-sim.ts::seriesOutcomes, same game model as the bracket sim),
 * regular-season head-to-head from kbo_games, and the bracket sim's title odds.
 */
import { TEAM_NAMES, type Franchise } from "./franchise";
import { ARTICLE_STYLE } from "./article-template";
import { ROUND_KO, type PostseasonRound } from "./postseason-ids";
import { seriesOutcomes } from "./postseason-sim";
import { completeJson } from "@/lib/llm-gateway";
import { josa } from "./josa";

const MODEL = process.env.KBO_ARTICLE_MODEL ?? "anthropic/claude-haiku-4.5";
const ko = (c: string) => TEAM_NAMES[c as Franchise]?.ko ?? c;

export interface RoundSide {
  code: string;
  ko: string;
  seed: number;
  record: string; // "78승 65패 1무"
  off: number; // 100 = league avg
  def: number;
  runsFor: number; // regular-season per game (shrunk)
  runsAgainst: number;
}

export interface RoundPreviewBrief {
  kind: "round-preview";
  season: number;
  date: string;
  round: PostseasonRound;
  roundKo: string;
  format: string;
  rule: string; // advancement rule in words
  firstGameDate: string;
  higher: RoundSide;
  lower: RoundSide;
  h2h: { higherWins: number; lowerWins: number; ties: number };
  schedule: { gameNo: number; date: string | null; hostKo: string; higherWin: number; reached: number }[]; // %
  outcomes: { label: string; prob: number }[]; // %
  seriesProb: { higher: number; lower: number };
  expectedGames: number;
  waiting: string | null; // who the winner meets next
  teams: { code: string; ko: string; seed: number; reachKS: number; champion: number }[];
}

export interface RoundPreviewProse {
  lede: string;
  matchup: string;
  scenarios: string;
  outlook: string;
}
const KEYS: (keyof RoundPreviewProse)[] = ["lede", "matchup", "scenarios", "outlook"];

const RULE: Record<PostseasonRound, (h: string, l: string) => string> = {
  WC: (h, l) => `${h}(4위)${josa(h, "은/는").slice(h.length)} 1승만 거두면 준플레이오프에 오르고, ${l}(5위)${josa(l, "은/는").slice(l.length)} 2경기를 모두 이겨야 한다. 두 경기 모두 ${h}의 홈에서 열린다.`,
  SPO: (h) => `5전 3선승제. ${h}(상위 시드)가 1·2·5차전을 홈에서 치른다.`,
  PO: (h) => `5전 3선승제. ${h}(상위 시드)가 1·2·5차전을 홈에서 치른다.`,
  KS: (h) => `7전 4선승제. ${h}(정규시즌 1위)가 1·2·6·7차전을 홈에서 치른다.`,
};
const FORMAT: Record<PostseasonRound, string> = {
  WC: "최대 2경기 · 4위 1승 어드밴티지", SPO: "5전 3선승제", PO: "5전 3선승제", KS: "7전 4선승제",
};
const NEXT: Record<PostseasonRound, number | null> = { WC: 3, SPO: 2, PO: 1, KS: null }; // seed waiting next

export function buildRoundPreviewBrief(args: {
  season: number;
  date: string;
  round: PostseasonRound;
  higher: RoundSide;
  lower: RoundSide;
  seeds: string[];
  pHostWins: (host: string, guest: string) => number;
  gameDates: string[]; // scheduled dates of this round, ascending
  h2h: { higherWins: number; lowerWins: number; ties: number };
  teams: RoundPreviewBrief["teams"];
}): RoundPreviewBrief {
  const { round, higher, lower } = args;
  const so = seriesOutcomes(round, higher.code, lower.code, args.pHostWins);
  const pct = (x: number) => Number((100 * x).toFixed(1));
  const nextSeed = NEXT[round];
  return {
    kind: "round-preview",
    season: args.season,
    date: args.date,
    round,
    roundKo: ROUND_KO[round],
    format: FORMAT[round],
    rule: RULE[round](higher.ko, lower.ko),
    firstGameDate: args.gameDates[0],
    higher,
    lower,
    h2h: args.h2h,
    schedule: so.perGame.map((g, i) => ({
      gameNo: g.gameNo, date: args.gameDates[i] ?? null, hostKo: ko(g.host), higherWin: pct(g.pHigher), reached: pct(g.pReached),
    })),
    outcomes: so.outcomes.map((o) => ({
      label: o.higherAdvances
        ? `${josa(`${higher.ko} ${o.higherWins}승${o.lowerWins ? ` ${o.lowerWins}패` : ""}`, "으로/로")} 진출`
        : `${josa(`${lower.ko} ${o.lowerWins}승${o.higherWins ? ` ${o.higherWins}패` : ""}`, "으로/로")} 진출`,
      prob: pct(o.prob),
    })),
    seriesProb: { higher: pct(so.pHigher), lower: pct(1 - so.pHigher) },
    expectedGames: Number(so.expectedGames.toFixed(2)),
    waiting: nextSeed ? ko(args.seeds[nextSeed - 1]) : null,
    teams: args.teams,
  };
}

// --------------------------------------------------------------------------- //

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const p1 = (v: number) => v.toFixed(1);
const md = (d: string) => d.slice(5).replace("-", "/");

export function roundPreviewTitle(b: RoundPreviewBrief): string {
  return `${b.roundKo} 프리뷰 — ${b.higher.ko} vs ${b.lower.ko} (${md(b.firstGameDate)} 개막)`;
}

export function roundPreviewTeaser(b: RoundPreviewBrief) {
  return {
    kicker: `KBO 포스트시즌 · ${b.roundKo} 프리뷰`,
    heroLabel: "시리즈 승리 확률",
    seriesLine: `${b.higher.seed}위 ${b.higher.ko} vs ${b.lower.seed}위 ${b.lower.ko}`,
    today: `${md(b.firstGameDate)} 1차전 개막`,
    result: `정규시즌 상대전적 ${b.higher.ko} ${b.h2h.higherWins}승 ${b.h2h.lowerWins}패${b.h2h.ties ? ` ${b.h2h.ties}무` : ""}`,
  };
}

export function renderRoundPreview(b: RoundPreviewBrief, prose: RoundPreviewProse) {
  const title = roundPreviewTitle(b);
  const dek = `${b.roundKo}(${b.format}) · ${b.higher.seed}위 ${b.higher.ko}(${b.higher.record}) vs ${b.lower.seed}위 ${b.lower.ko}(${b.lower.record}) · ${md(b.firstGameDate)} 개막.`;
  const side = (s: RoundSide) =>
    `<tr><td>${esc(s.ko)} (${s.seed}위)</td><td class="r">${esc(s.record)} · 경기당 ${s.runsFor.toFixed(2)}득점 / ${s.runsAgainst.toFixed(2)}실점 · 공격 ${s.off.toFixed(0)} / 수비 ${s.def.toFixed(0)}</td></tr>`;
  const schedule = b.schedule.map((g) =>
    `<tr><td class="c">${g.gameNo}</td><td class="l">${g.date ? md(g.date) : "미정"}</td><td class="l">${esc(g.hostKo)} 홈</td>
     <td class="accent">${p1(g.higherWin)}%</td><td>${p1(g.reached)}%</td></tr>`).join("");
  const outcomes = b.outcomes.map((o) =>
    `<tr><td class="l">${esc(o.label)}</td><td class="accent">${p1(o.prob)}%</td></tr>`).join("");
  const odds = b.teams.map((t) =>
    `<tr class="${t.code === b.higher.code || t.code === b.lower.code ? "me" : ""}"><td class="c">${t.seed}</td><td class="l">${esc(t.ko)}</td>
     <td>${p1(t.reachKS)}%</td><td class="accent">${p1(t.champion)}%</td></tr>`).join("");

  const bodyHtml = `${ARTICLE_STYLE}
<article class="kbo-article">
  <div class="brand">Blinkers · KBO 포스트시즌 라운드 프리뷰</div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(prose.lede)}</p>
  <div class="byline"><span><b>${esc(b.roundKo)}</b> ${esc(b.format)}</span><span>${esc(b.date)} 발행</span><span>${md(b.firstGameDate)} 개막</span></div>
  <div class="hero"><div><div class="big">${p1(b.seriesProb.higher)}<span>%</span></div></div>
    <div class="htxt"><div class="t">${esc(b.higher.ko)} 시리즈 승리 확률</div>
    <div class="d">${esc(b.lower.ko)} ${p1(b.seriesProb.lower)}% · 예상 경기 수 ${b.expectedGames.toFixed(1)}경기. ${esc(b.rule)}</div></div></div>

  <h2>Matchup · 전력 비교</h2>
  <div class="h2title">정규시즌 기준 두 팀</div>
  <div class="tablecard"><table><tbody>${side(b.higher)}${side(b.lower)}
    <tr><td>정규시즌 상대전적</td><td class="r">${esc(b.higher.ko)} ${b.h2h.higherWins}승 ${b.h2h.lowerWins}패${b.h2h.ties ? ` ${b.h2h.ties}무` : ""}</td></tr>
  </tbody></table></div>
  <p>${esc(prose.matchup)}</p>

  <h2>Games · 경기별 승부예측</h2>
  <div class="h2title">차전별 ${esc(b.higher.ko)} 승리 확률</div>
  <div class="tablecard"><table class="race">
    <thead><tr><th class="c">차전</th><th class="l">날짜</th><th class="l">구장</th><th>${esc(b.higher.ko)} 승</th><th>성사 확률</th></tr></thead>
    <tbody>${schedule}</tbody></table></div>
  <p class="fine">성사 확률: 시리즈가 그 차전까지 이어질 확률.</p>

  <h2>Scenarios · 시리즈 시나리오</h2>
  <div class="h2title">최종 전적별 확률</div>
  <div class="tablecard"><table class="race"><thead><tr><th class="l">결과</th><th>확률</th></tr></thead><tbody>${outcomes}</tbody></table></div>
  <p>${esc(prose.scenarios)}</p>

  <h2>Outlook · 그 다음</h2>
  <div class="h2title">${b.waiting ? `승자는 ${esc(b.waiting)}와 맞붙는다` : "한국시리즈 우승 확률"}</div>
  <div class="tablecard"><table class="race"><thead><tr><th class="c">시드</th><th class="l">팀</th><th>KS 진출</th><th>우승</th></tr></thead><tbody>${odds}</tbody></table></div>
  <p>${esc(prose.outlook)}</p>

  <div class="foot">
    <b>방법론 — 시뮬레이션 기반 예측.</b> 정규시즌 득점·실점력을 리그 평균으로 수축(0.7) 보정한 뒤 음이항 득점 분포로
    경기별 승리 확률을 계산하고(홈 이점 반영, 선발 투수 매치업 미반영), 라운드 규정의 홈 배정대로 모든 경기 경로를 따라
    시리즈 최종 전적 확률을 정확히 계산했다. 우승 확률은 남은 대진 전체를 4만 회 몬테카를로로 시뮬레이션한 값이다.
    수치는 추정치이며 실제 결과를 보장하지 않는다. 생성 ${esc(b.date)}.
  </div>
</article>`;
  return { title, dek, teaser: roundPreviewTeaser(b), bodyHtml };
}

// --------------------------------------------------------------------------- //

const SYSTEM = [
  "당신은 KBO 포스트시즌을 데이터로 분석하는 전문 야구 칼럼니스트입니다.",
  "제공된 브리프(JSON)만으로 다가오는 포스트시즌 라운드의 프리뷰 기사를 깊이 있는 한국어로 씁니다.",
  "규칙:",
  "1) 브리프의 숫자·사실(순위·전적·상대전적·득실점·확률·시나리오)만 정확히 인용하세요. 브리프에 없는 선수 이름·선발 투수·부상·감독 발언은 절대 지어내지 마세요.",
  "2) rule(진출 규정)을 정확히 설명하고, 그 규정이 시리즈 확률에 주는 영향을 분석하세요.",
  "   필드 의미: off/def = 리그 평균을 100으로 둔 공격·수비 지수(높을수록 좋음, OPS·ERA가 아님 — '공격 지수 99'처럼 쓰세요). runsFor/runsAgainst = 경기당 득점·실점(리그 평균 쪽으로 보정된 값).",
  "3) 확률은 시뮬레이션 추정치임을 전제로 '모델은 ~로 본다' 식으로 서술. 과장·감탄사 자제. 홈/원정, 상대전적 등 표준 야구 용어 사용.",
  "4) 분량: lede 2~3문장, matchup·scenarios·outlook 각 4~6문장.",
  '5) JSON 객체 하나만 출력: {"lede","matchup","scenarios","outlook"}.',
  "   lede = 대진과 핵심 관전 포인트. matchup = 두 팀 정규시즌 전력·상대전적 비교. scenarios = 경기별 승리 확률과 최종 전적 시나리오. outlook = 승자가 만날 상대와 우승 확률 전망.",
  "6) 인사말·설명·코드블록 없이 JSON만.",
].join("\n");

export function fallbackRoundPreviewProse(b: RoundPreviewBrief): RoundPreviewProse {
  const top = b.outcomes[0];
  return {
    lede: `${josa(b.roundKo, "이/가")} ${md(b.firstGameDate)} 막을 올린다. 정규시즌 ${b.higher.seed}위 ${b.higher.ko}와 ${b.lower.seed}위 ${b.lower.ko}의 대결이다.`,
    matchup: `${josa(b.higher.ko, "은/는")} 정규시즌 ${b.higher.record}, ${josa(b.lower.ko, "은/는")} ${b.lower.record}를 기록했다. 두 팀의 정규시즌 상대전적은 ${b.higher.ko} 기준 ${b.h2h.higherWins}승 ${b.h2h.lowerWins}패다.`,
    scenarios: `모델은 ${b.higher.ko}의 시리즈 승리 확률을 ${p1(b.seriesProb.higher)}%로 본다. 가장 가능성이 높은 시나리오는 '${top.label}'(${p1(top.prob)}%)이며, 예상 경기 수는 ${b.expectedGames.toFixed(1)}경기다.`,
    outlook: b.waiting ? `이 시리즈의 승자는 다음 라운드에서 ${b.waiting}와 맞붙는다.` : `한국시리즈 우승 확률은 표와 같다.`,
  };
}

export async function writeRoundPreviewProse(b: RoundPreviewBrief): Promise<{ prose: RoundPreviewProse; model: string }> {
  try {
    const parsed = await completeJson(MODEL, SYSTEM, `라운드: ${b.roundKo} ${b.higher.ko} vs ${b.lower.ko}. 발행일: ${b.date}.\n브리프:\n${JSON.stringify(b)}`);
    if (parsed === null) return { prose: fallbackRoundPreviewProse(b), model: "template" };
    const o = parsed as Record<string, unknown>;
    const out = {} as RoundPreviewProse;
    for (const k of KEYS) {
      if (typeof o[k] !== "string" || !(o[k] as string).trim()) throw new Error("malformed prose json");
      out[k] = (o[k] as string).trim();
    }
    return { prose: out, model: MODEL };
  } catch (e) {
    console.error("[kbo-round-preview] prose fell back to template:", e instanceof Error ? e.message : e);
    return { prose: fallbackRoundPreviewProse(b), model: "template" };
  }
}
