/**
 * Renders a data brief + narrative prose into a newspaper-style article.
 *
 * Generalizes the hand-made kbo/outputs/hanwha-fall-baseball-*.html to all 10
 * teams. Output is a SELF-CONTAINED, SCOPED fragment: a `<style>` block scoped
 * under `.kbo-article` travels with the markup, so the React article page can
 * inject it with dangerouslySetInnerHTML and the gate can blur it, without a
 * full document or leaking styles into the app. Colors follow the same design
 * tokens as the Hanwha report and adapt to light/dark.
 *
 * INVARIANT: every authoritative number is printed here from the BRIEF. The
 * PROSE (LLM or fallback) only fills the narrative paragraphs, and is
 * HTML-escaped before it lands in the body — so a stray figure in the prose
 * can't reach the reader as a styled fact, and nothing the model emits can
 * inject markup.
 */
import type { ArticleBrief, ArticleProse, ArticleTeaser, RenderedArticle } from "./article-types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pct1 = (v: number): string => v.toFixed(1);
const signed = (v: number): string => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

/** ".454" style win-pct (leading zero dropped, KBO convention). */
function fmtPct(p: number): string {
  return p.toFixed(3).replace(/^0/, "");
}

function recordText(b: ArticleBrief): string {
  const s = b.standings;
  return `${s.win}승 ${s.lose}패${s.draw ? ` ${s.draw}무` : ""}`;
}

function todayLine(b: ArticleBrief): string | null {
  if (!b.today) return null;
  return `오늘 vs ${b.today.opp} · ${b.today.home ? "홈" : "원정"}`;
}

export function buildTeaser(b: ArticleBrief): ArticleTeaser {
  return {
    kicker: "가을야구 레이스",
    heroLabel: "가을야구 진출 확률",
    rank: b.standings.rank,
    record: recordText(b),
    pct: fmtPct(b.standings.pct),
    gamesRemaining: b.standings.gamesRemaining,
    today: todayLine(b),
  };
}

// The precise 가을야구 odds are the paid reveal, so they stay OUT of the title
// (shown on cards + the browser tab). The title entices with public facts only.
export function buildTitle(b: ArticleBrief): string {
  const md = b.date.slice(5).replace("-", "/");
  return `${b.ko} 가을야구 리포트 (${md}) — ${b.standings.rank}위 · 잔여 ${b.standings.gamesRemaining}경기`;
}

export function buildDek(b: ArticleBrief): string {
  const s = b.standings;
  const spot = s.inPlayoffSpot
    ? `가을야구 마지노선 안쪽(${s.rank}위)`
    : `5위까지 ${s.gbCut.toFixed(1)}경기 차(${s.rank}위)`;
  return `정규시즌 ${s.gamesPlayed}경기 · ${recordText(b)} · ${spot} · 잔여 ${s.gamesRemaining}경기.`;
}

// --------------------------------------------------------------------------- //
// HTML sections.                                                              //
// --------------------------------------------------------------------------- //

function heroSection(b: ArticleBrief): string {
  const trend =
    b.trendPlayoff == null
      ? ""
      : `<div class="arw">전일 대비 <b class="${b.trendPlayoff >= 0 ? "up" : "dn"}">${signed(
          b.trendPlayoff,
        )}p</b></div>`;
  const power =
    b.powerPlayoffPct == null
      ? ""
      : `<div class="d">전력만 반영한 ‘0-0 재출발’ 시뮬은 ${pct1(
          b.powerPlayoffPct,
        )}%. 현재 순위를 고정한 조건부 확률과는 크게 다르다.</div>`;
  return `
  <div class="hero">
    <div>
      <div class="big">${pct1(b.playoffPct)}<span>%</span></div>
      ${trend}
    </div>
    <div class="htxt">
      <div class="t">가을야구(top 5) 진출 확률</div>
      <div class="d">현재 ${b.standings.rank}위 · ${esc(recordText(b))} · 잔여 ${b.standings.gamesRemaining}경기 기준 조건부 시뮬레이션.</div>
      ${power}
    </div>
  </div>`;
}

function todayChips(b: ArticleBrief): string {
  if (!b.today) {
    return `<div class="today"><span class="chip">오늘 경기 없음</span></div>`;
  }
  const t = b.today;
  return `
  <div class="today">
    <span class="chip">오늘 <b>${esc(t.home ? "홈" : "원정")}</b> vs <b>${esc(t.opp)}</b></span>
    <span class="chip">예상 승률 <b>${pct1(t.winProb)}%</b></span>
    <span class="chip">예상 스코어 <b>${t.projFor.toFixed(1)}–${t.projAgainst.toFixed(1)}</b></span>
    ${t.stadium ? `<span class="chip">${esc(t.stadium)}</span>` : ""}
  </div>`;
}

function standingsTable(b: ArticleBrief): string {
  const s = b.standings;
  const rows: [string, string][] = [
    ["순위", `${s.rank}위`],
    ["전적", `${recordText(b)} · 승률 ${fmtPct(s.pct)}`],
    ["1위와 승차", `${s.gbLeader.toFixed(1)}G`],
    ["5위 컷과 승차", s.inPlayoffSpot ? `+${Math.abs(s.gbCut).toFixed(1)}G (여유)` : `${s.gbCut.toFixed(1)}G`],
    ["잔여 경기", `${s.gamesRemaining}경기`],
    ["최근 5경기", s.lastFive ?? "—"],
    ["연속", s.streak ?? "—"],
  ];
  const body = rows
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`)
    .join("");
  return `<div class="tablecard"><table><tbody>${body}</tbody></table></div>`;
}

function ratingLine(b: ArticleBrief): string {
  if (b.offRating == null || b.defRating == null) return "";
  return `<div class="today">
    <span class="chip">공격 <b>${b.offRating.toFixed(0)}</b></span>
    <span class="chip">수비 <b>${b.defRating.toFixed(0)}</b></span>
    <span class="chip">(100 = 리그 평균)</span>
  </div>`;
}

function topPlayerLine(b: ArticleBrief): string {
  const p = b.topPlayer;
  if (!p || !p.name) return "";
  const metric = p.metric != null ? ` · ${p.metricLabel} ${p.metric}` : "";
  const war = p.war != null ? ` · WAR ${p.war}` : "";
  return `<p class="fine">팀 내 최고 가치: <strong>${esc(p.name)}</strong>${esc(war)}${esc(metric)}</p>`;
}

const STYLE = `<style>
.kbo-article{
  --bg:#faf9f7;--surface:#fff;--ink:#1a1a18;--ink2:#4a4a45;--muted:#8a8a82;
  --line:#e6e3dd;--line2:#efece7;--accent:#e35205;--win:#2f8f5b;--tough:#c14b4b;
  --serif:"Iowan Old Style","Apple SD Gothic Neo",Georgia,"Noto Serif KR",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Segoe UI",sans-serif;
  color:var(--ink);font-family:var(--sans);line-height:1.68;max-width:720px;
}
@media (prefers-color-scheme:dark){.kbo-article{
  --bg:#151513;--surface:#1e1e1b;--ink:#f2efe9;--ink2:#c4c0b7;--muted:#8f8b81;
  --line:#33322d;--line2:#2a2926;--accent:#ff6a2b;--win:#4fb37e;--tough:#e0716f;}}
.kbo-article *{box-sizing:border-box}
.kbo-article .brand{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
.kbo-article h1{font-family:var(--serif);font-weight:700;font-size:30px;line-height:1.24;letter-spacing:-.01em;margin:0 0 12px}
.kbo-article .sub{font-size:16px;color:var(--ink2);margin:0 0 18px;line-height:1.55}
.kbo-article .byline{font-size:12.5px;color:var(--muted);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px 0;margin:0 0 22px;display:flex;flex-wrap:wrap;gap:6px 16px}
.kbo-article .byline b{color:var(--ink2);font-weight:600}
.kbo-article p{margin:0 0 16px;font-size:16px;color:var(--ink)}
.kbo-article p.lede{font-size:18px}
.kbo-article p.fine{font-size:13.5px;color:var(--muted)}
.kbo-article strong{font-weight:700}
.kbo-article .today{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px;font-size:13px}
.kbo-article .chip{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:4px 11px;color:var(--ink2);font-variant-numeric:tabular-nums}
.kbo-article .chip b{color:var(--ink)}
.kbo-article .hero{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:6px 0 26px;display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.kbo-article .hero .big{font-family:var(--serif);font-size:54px;font-weight:700;color:var(--accent);line-height:1;letter-spacing:-.02em}
.kbo-article .hero .big span{font-size:26px;margin-left:2px}
.kbo-article .hero .arw{font-size:12.5px;color:var(--muted);margin-top:6px}
.kbo-article .hero .arw b.up{color:var(--win)}
.kbo-article .hero .arw b.dn{color:var(--tough)}
.kbo-article .hero .htxt{flex:1;min-width:220px}
.kbo-article .hero .htxt .t{font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:5px}
.kbo-article .hero .htxt .d{font-size:14.5px;color:var(--ink2);line-height:1.5;margin-top:4px}
.kbo-article h2{font-family:var(--sans);font-size:13px;font-weight:800;letter-spacing:.02em;color:var(--accent);margin:32px 0 6px;text-transform:uppercase}
.kbo-article .h2title{font-family:var(--serif);font-size:20px;font-weight:700;color:var(--ink);margin:0 0 12px;letter-spacing:-.01em}
.kbo-article .tablecard{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:6px 0 18px;background:var(--surface)}
.kbo-article table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
.kbo-article td{padding:9px 12px;border-top:1px solid var(--line2);color:var(--ink2)}
.kbo-article tr:first-child td{border-top:0}
.kbo-article td.r{text-align:right;color:var(--ink);font-weight:600}
.kbo-article .foot{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);line-height:1.6}
</style>`;

/**
 * Render the full article. Returns the public title/dek/teaser and the gated
 * body_html fragment.
 */
export function renderArticle(brief: ArticleBrief, prose: ArticleProse): RenderedArticle {
  const title = buildTitle(brief);
  const dek = buildDek(brief);
  const teaser = buildTeaser(brief);

  const bodyHtml = `${STYLE}
<article class="kbo-article">
  <div class="brand">Blinkers · KBO 데일리</div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(prose.lede)}</p>
  <div class="byline"><span><b>${esc(brief.ko)}</b> ${esc(brief.en)}</span><span>${esc(brief.date)}</span><span>정규시즌 ${brief.standings.gamesPlayed}경기</span></div>

  ${heroSection(brief)}

  <h2>어제</h2>
  <div class="h2title">전날 결과</div>
  ${brief.yesterday ? `<div class="today"><span class="chip ${brief.yesterday.result === "W" ? "" : ""}">${esc(brief.yesterday.home ? "홈" : "원정")} vs <b>${esc(brief.yesterday.opp)}</b> · <b>${brief.yesterday.teamScore}–${brief.yesterday.oppScore}</b> ${brief.yesterday.result === "W" ? "승" : brief.yesterday.result === "L" ? "패" : "무"}</span></div>` : ""}
  <p>${esc(prose.recap)}</p>

  <h2>오늘</h2>
  <div class="h2title">오늘 경기 관전 포인트</div>
  ${todayChips(brief)}
  <p>${esc(prose.preview)}</p>

  <h2>순위표</h2>
  <div class="h2title">가을야구 레이스</div>
  ${standingsTable(brief)}
  ${ratingLine(brief)}
  <p>${esc(prose.outlook)}</p>
  ${topPlayerLine(brief)}

  <div class="foot">
    방법론: 네이버 스포츠(로봇 허용 게이트웨이)의 경기·기록을 인하우스 세이버메트릭스로 재계산하고,
    잔여 일정을 균형 라운드로빈으로 재구성해 현재 순위를 고정한 조건부 몬테카를로로 가을야구 확률을 산출한다.
    수치는 시뮬레이션 추정치이며 실제 결과를 보장하지 않는다. 생성 ${esc(brief.date)}.
  </div>
</article>`;

  return { title, dek, teaser, bodyHtml };
}
