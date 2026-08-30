/**
 * Renders a data brief + narrative prose into a newspaper-style article.
 *
 * Output is a SELF-CONTAINED, SCOPED fragment: a `<style>` block scoped under
 * `.kbo-article` travels with the markup, so the React article page can inject
 * it with dangerouslySetInnerHTML and the gate can blur it, without a full
 * document or leaking styles into the app.
 *
 * The host app (`web/`) is a permanently DARK UI (navy gradient, no light mode),
 * so the palette here is unconditionally dark — light text on translucent
 * surfaces that blend with the app background. (Earlier this used a light default
 * + `prefers-color-scheme` media query, which rendered dark-on-dark when the OS
 * was in light mode.)
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
      : `<div class="d">참고로 현재 순위를 무시한 ‘0-0 재출발’ 전력 시뮬은 ${pct1(
          b.powerPlayoffPct,
        )}%. 순위를 고정한 조건부 확률과 크게 다르다.</div>`;
  return `
  <div class="hero">
    <div>
      <div class="big">${pct1(b.playoffPct)}<span>%</span></div>
      ${trend}
    </div>
    <div class="htxt">
      <div class="t">가을야구(top 5) 진출 확률 · 조건부 시뮬레이션</div>
      <div class="d">현재 ${b.standings.rank}위 · ${esc(recordText(b))} · 잔여 ${b.standings.gamesRemaining}경기를 반영한 4만 회 몬테카를로 추정값.</div>
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

/** Full league 가을야구 race table — every team's record, cut margin, yesterday's
 *  result, and conditional PO%. This is the raw material for the race analysis. */
function raceTable(b: ArticleBrief): string {
  const rows = b.raceContext
    .map((t) => {
      const cls = [t.inPlayoffSpot ? "cut" : "", t.code === b.team ? "me" : ""].filter(Boolean).join(" ");
      const y = t.yesterday
        ? `${t.yesterday.result === "W" ? "○" : t.yesterday.result === "L" ? "●" : "△"} ${t.yesterday.teamScore}-${t.yesterday.oppScore} ${esc(t.yesterday.opp)}`
        : "휴식";
      const gb = t.rank === 5 ? "—" : t.gbCut < 0 ? `+${Math.abs(t.gbCut).toFixed(1)}` : t.gbCut.toFixed(1);
      return `<tr class="${cls}">
        <td class="c">${t.rank}</td>
        <td class="l">${esc(t.ko)}</td>
        <td>${t.win}-${t.lose}${t.draw ? `-${t.draw}` : ""}</td>
        <td>${gb}</td>
        <td class="l small">${y}</td>
        <td class="accent">${pct1(t.playoffPct)}%</td>
      </tr>`;
    })
    .join("");
  return `<div class="tablecard"><table class="race">
    <thead><tr><th class="c">#</th><th class="l">팀</th><th>전적</th><th>5위차</th><th class="l">어제</th><th>PO%</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="fine">○ 승 · ● 패 · △ 무 · 5위차: +는 커트 안쪽 여유, 진하게 표시된 행이 ${esc(b.ko)}.</p>`;
}

function standingsTable(b: ArticleBrief): string {
  const s = b.standings;
  const rows: [string, string][] = [
    ["순위", `${s.rank}위`],
    ["전적", `${recordText(b)} · 승률 ${fmtPct(s.pct)}`],
    ["1위와 승차", `${s.gbLeader.toFixed(1)}G`],
    ["5위 컷과 승차", s.inPlayoffSpot ? `+${Math.abs(s.gbCut).toFixed(1)}G (여유)` : `${s.gbCut.toFixed(1)}G`],
    ["잔여 경기", `${s.gamesRemaining}경기`],
    ["공격/수비 지표", b.offRating != null && b.defRating != null ? `${b.offRating.toFixed(0)} / ${b.defRating.toFixed(0)} (100=평균)` : "—"],
  ];
  const body = rows
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`)
    .join("");
  return `<div class="tablecard"><table><tbody>${body}</tbody></table></div>`;
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
  --ink:#eef2f7;--ink2:#c3ccd8;--muted:#8a95a5;
  --line:rgba(148,163,184,0.16);--line2:rgba(148,163,184,0.10);
  --surface:rgba(255,255,255,0.035);--surface2:rgba(255,255,255,0.06);
  --accent:#ff7a3c;--win:#4fb37e;--tough:#e0716f;
  --serif:"Iowan Old Style",Georgia,"Apple SD Gothic Neo","Noto Serif KR",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Segoe UI",sans-serif;
  color:var(--ink);font-family:var(--sans);line-height:1.72;max-width:720px;
}
.kbo-article *{box-sizing:border-box}
.kbo-article .brand{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
.kbo-article h1{font-family:var(--serif);font-weight:700;font-size:30px;line-height:1.26;letter-spacing:-.01em;margin:0 0 12px;color:var(--ink)}
.kbo-article .sub{font-size:17px;color:var(--ink2);margin:0 0 18px;line-height:1.6}
.kbo-article .byline{font-size:12.5px;color:var(--muted);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px 0;margin:0 0 22px;display:flex;flex-wrap:wrap;gap:6px 16px}
.kbo-article .byline b{color:var(--ink2);font-weight:600}
.kbo-article p{margin:0 0 16px;font-size:16px;color:var(--ink);line-height:1.75}
.kbo-article p.lede{font-size:18px}
.kbo-article p.fine{font-size:13px;color:var(--muted);line-height:1.6}
.kbo-article strong{font-weight:700;color:var(--ink)}
.kbo-article .today{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;font-size:13px}
.kbo-article .chip{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:4px 11px;color:var(--ink2);font-variant-numeric:tabular-nums}
.kbo-article .chip b{color:var(--ink)}
.kbo-article .hero{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:6px 0 26px;display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.kbo-article .hero .big{font-family:var(--serif);font-size:56px;font-weight:700;color:var(--accent);line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kbo-article .hero .big span{font-size:26px;margin-left:2px}
.kbo-article .hero .arw{font-size:12.5px;color:var(--muted);margin-top:6px}
.kbo-article .hero .arw b.up{color:var(--win)}
.kbo-article .hero .arw b.dn{color:var(--tough)}
.kbo-article .hero .htxt{flex:1;min-width:220px}
.kbo-article .hero .htxt .t{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:5px}
.kbo-article .hero .htxt .d{font-size:14.5px;color:var(--ink2);line-height:1.55;margin-top:4px}
.kbo-article h2{font-family:var(--sans);font-size:12.5px;font-weight:800;letter-spacing:.06em;color:var(--accent);margin:34px 0 6px;text-transform:uppercase}
.kbo-article .h2title{font-family:var(--serif);font-size:21px;font-weight:700;color:var(--ink);margin:0 0 12px;letter-spacing:-.01em}
.kbo-article .tablecard{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:6px 0 14px;background:var(--surface)}
.kbo-article table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
.kbo-article td{padding:9px 12px;border-top:1px solid var(--line2);color:var(--ink2)}
.kbo-article tr:first-child td{border-top:0}
.kbo-article td.r{text-align:right;color:var(--ink);font-weight:600}
.kbo-article table.race{font-size:13px}
.kbo-article table.race thead th{background:var(--surface2);color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:right;padding:8px 10px;border:0}
.kbo-article table.race th.l,.kbo-article table.race td.l{text-align:left}
.kbo-article table.race th.c,.kbo-article table.race td.c{text-align:center}
.kbo-article table.race td{padding:8px 10px;text-align:right;color:var(--ink2)}
.kbo-article table.race td.small{font-size:12px;color:var(--muted)}
.kbo-article table.race td.accent{color:var(--accent);font-weight:700}
.kbo-article table.race tr.cut td{background:rgba(79,179,126,0.07)}
.kbo-article table.race tr.me td{background:var(--surface2);color:var(--ink);font-weight:600}
.kbo-article .foot{margin-top:32px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);line-height:1.7}
.kbo-article .foot b{color:var(--ink2)}
</style>`;

/**
 * Render the full article. Returns the public title/dek/teaser and the gated
 * body_html fragment.
 */
export function renderArticle(brief: ArticleBrief, prose: ArticleProse): RenderedArticle {
  const title = buildTitle(brief);
  const dek = buildDek(brief);
  const teaser = buildTeaser(brief);

  const yBadge = brief.yesterday
    ? `<div class="today"><span class="chip">${esc(brief.yesterday.home ? "홈" : "원정")} vs <b>${esc(brief.yesterday.opp)}</b> · <b>${brief.yesterday.teamScore}–${brief.yesterday.oppScore}</b> ${brief.yesterday.result === "W" ? "승" : brief.yesterday.result === "L" ? "패" : "무"}</span></div>`
    : "";

  const bodyHtml = `${STYLE}
<article class="kbo-article">
  <div class="brand">Blinkers · KBO 데일리</div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(prose.lede)}</p>
  <div class="byline"><span><b>${esc(brief.ko)}</b> ${esc(brief.en)}</span><span>${esc(brief.date)}</span><span>정규시즌 ${brief.standings.gamesPlayed}경기</span></div>

  ${heroSection(brief)}

  <h2>Recap · 어제</h2>
  <div class="h2title">전날 경기</div>
  ${yBadge}
  <p>${esc(prose.recap)}</p>

  <h2>Preview · 오늘</h2>
  <div class="h2title">오늘 경기 관전 포인트</div>
  ${todayChips(brief)}
  <p>${esc(prose.preview)}</p>

  <h2>Race · 가을야구 경쟁 구도</h2>
  <div class="h2title">5위 커트라인 레이스</div>
  ${raceTable(brief)}
  <p>${esc(prose.race)}</p>

  <h2>Outlook · 전망</h2>
  <div class="h2title">남은 과제</div>
  ${standingsTable(brief)}
  <p>${esc(prose.outlook)}</p>
  ${topPlayerLine(brief)}

  <div class="foot">
    <b>방법론 — 시뮬레이션 기반 예측.</b> 이 리포트의 모든 확률은 실제 경기 결과가 아니라 시뮬레이션 산출값이다.
    각 팀의 시즌 득점·실점력을 리그 평균으로 수축(shrink) 보정한 뒤, 음이항(Negative Binomial) 득점 분포로
    경기별 승·무·패 확률을 계산한다. 현재 순위와 전적을 그대로 고정한 채 남은 일정을 팀 간 균형 라운드로빈으로
    재구성하고, 정규시즌 종료까지 <b>4만 회 몬테카를로</b>로 반복 시뮬레이션하여 각 팀이 5위 이내(가을야구)에 드는
    빈도로 진출 확률을 추정한다. 홈 이점과 경기별 득점 변동성(과산포)을 반영했다. ‘전일 대비’ 추세는 어제까지의
    결과가 새로 반영되며 확률이 움직인 폭이다. 수치는 추정치이며 실제 결과를 보장하지 않는다. 생성 ${esc(brief.date)}.
  </div>
</article>`;

  return { title, dek, teaser, bodyHtml };
}
