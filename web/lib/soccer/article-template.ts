/**
 * Renders a soccer match-report brief + prose into the scoped article fragment.
 * Reuses the KBO report stylesheet (`.kbo-article`) so both leagues read as one
 * product. Same invariant: every number is printed from the BRIEF; prose is
 * escaped narrative only.
 */
import { ARTICLE_STYLE } from "@/lib/kbo/article-template";
import type {
  RenderedSoccerArticle,
  Result,
  SoccerBrief,
  SoccerProse,
  SoccerTeaser,
  TeamPrediction,
} from "./article-types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const p1 = (v: number) => v.toFixed(1);
const signed = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
const resultKo = (r: Result) => (r === "W" ? "승" : r === "L" ? "패" : "무");
const venue = (home: boolean) => (home ? "홈" : "원정");
const md = (date: string) => date.slice(5).replace("-", "/");

export function recordText(b: SoccerBrief): string {
  const s = b.standings;
  return `${s.w}승 ${s.d}무 ${s.l}패`;
}

function resultLine(b: SoccerBrief): string {
  const r = b.review;
  return `vs ${r.opp} ${r.teamScore}-${r.oppScore} ${resultKo(r.result)} · ${venue(r.home)}`;
}

function nextLine(b: SoccerBrief): string | null {
  const p = b.preview;
  return p ? `다음 ${p.kickoffKst} vs ${p.opp} · ${venue(p.home)}` : null;
}

export function buildTeaser(b: SoccerBrief): SoccerTeaser {
  return {
    kicker: `${b.leagueKo} 매치 리포트`,
    heroLabel: "다음 경기 승부예측",
    rank: b.standings.rank,
    record: recordText(b),
    pts: b.standings.pts,
    result: resultLine(b),
    next: nextLine(b),
  };
}

// The model's probabilities are the paid reveal → title/dek carry public facts only.
export function buildTitle(b: SoccerBrief): string {
  const r = b.review;
  const next = b.preview ? ` · 다음 ${b.preview.opp}전` : "";
  return `${b.ko} 매치 리포트 (${md(b.date)}) — ${r.opp}전 ${r.teamScore}-${r.oppScore} ${resultKo(r.result)}${next}`;
}

export function buildDek(b: SoccerBrief): string {
  const s = b.standings;
  return `${b.leagueKo} ${s.played}경기 · ${recordText(b)} · 승점 ${s.pts} · ${s.rank}위.`;
}

function predChips(p: TeamPrediction, oppLabel: string): string {
  return `
  <div class="today">
    <span class="chip">승 <b>${p1(p.win)}%</b></span>
    <span class="chip">무 <b>${p1(p.draw)}%</b></span>
    <span class="chip">패 <b>${p1(p.loss)}%</b></span>
    <span class="chip">기대득점 <b>${p.xgFor.toFixed(2)}–${p.xgAgainst.toFixed(2)}</b> vs ${esc(oppLabel)}</span>
    <span class="chip">최빈 스코어 <b>${esc(p.topScore)}</b></span>
  </div>`;
}

function heroSection(b: SoccerBrief): string {
  const p = b.preview;
  if (!p) {
    return `
  <div class="hero"><div class="htxt">
    <div class="t">다음 경기 승부예측</div>
    <div class="d">공개된 다음 경기 일정이 아직 없다.</div>
  </div></div>`;
  }
  return `
  <div class="hero">
    <div><div class="big">${p1(p.pred.win)}<span>%</span></div></div>
    <div class="htxt">
      <div class="t">다음 경기 승리 확률 · ${esc(p.kickoffKst)} vs ${esc(p.opp)} (${venue(p.home)})</div>
      <div class="d">무승부 ${p1(p.pred.draw)}% · 패배 ${p1(p.pred.loss)}% · 기대득점 ${p.pred.xgFor.toFixed(2)}–${p.pred.xgAgainst.toFixed(2)}.</div>
    </div>
  </div>`;
}

function reviewBlock(b: SoccerBrief): string {
  const r = b.review;
  const chip = `<div class="today"><span class="chip">${esc(venue(r.home))} vs <b>${esc(r.opp)}</b> · <b>${r.teamScore}–${r.oppScore}</b> ${resultKo(r.result)}</span></div>`;
  if (!r.pred) {
    return `${chip}<p class="fine">이 경기는 모델 도입 이전이라 사전 예측 기록이 없다.</p>`;
  }
  const verdict = r.hit ? "예측 적중" : "예측 빗나감";
  return `${chip}
  <div class="tablecard"><table><tbody>
    <tr><td>경기 전 예측 (승·무·패)</td><td class="r">${p1(r.pred.win)}% · ${p1(r.pred.draw)}% · ${p1(r.pred.loss)}%</td></tr>
    <tr><td>경기 전 기대득점</td><td class="r">${r.pred.xgFor.toFixed(2)}–${r.pred.xgAgainst.toFixed(2)}</td></tr>
    <tr><td>실제 결과</td><td class="r">${r.teamScore}–${r.oppScore} ${resultKo(r.result)} · ${verdict}</td></tr>
  </tbody></table></div>`;
}

function tableBlock(b: SoccerBrief): string {
  const rows = b.table
    .map((t) => {
      const cls = [t.rank <= b.zones.top ? "cut" : "", t.code === b.team ? "me" : ""].filter(Boolean).join(" ");
      return `<tr class="${cls}">
        <td class="c">${t.rank}</td><td class="l">${esc(t.name)}</td>
        <td>${t.played}</td><td>${t.gd > 0 ? `+${t.gd}` : t.gd}</td><td>${t.pts}</td>
        <td class="accent">${p1(t.top)}%</td><td>${p1(t.bottom)}%</td>
      </tr>`;
    })
    .join("");
  return `<div class="tablecard"><table class="race">
    <thead><tr><th class="c">#</th><th class="l">팀</th><th>경기</th><th>득실</th><th>승점</th><th>상위${b.zones.top}</th><th>하위${b.zones.bottom}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="fine">상위${b.zones.top}·하위${b.zones.bottom}: 남은 공개 일정 ${b.remainingFixtures}경기를 2만 회 시뮬레이션해 해당 순위권으로 마칠 확률. 진하게 표시된 행이 ${esc(b.ko)}.</p>`;
}

function outlookBlock(b: SoccerBrief): string {
  const s = b.standings;
  const t = (v: number | null) => (v == null ? "" : ` (직전 리포트 대비 ${signed(v)}p)`);
  const rows: [string, string][] = [
    ["순위 · 승점", `${s.rank}위 · ${s.pts}점 (1위와 ${s.gapLeader}점 차)`],
    ["득점 · 실점", `${s.gf} · ${s.ga}`],
    ["최근 5경기", s.lastFive ?? "—"],
    ["우승 확률", `${p1(b.sim.title)}%`],
    [`상위 ${b.zones.top}위 확률`, `${p1(b.sim.top)}%${t(b.sim.trendTop)}`],
    [`하위 ${b.zones.bottom}위 확률`, `${p1(b.sim.bottom)}%${t(b.sim.trendBottom)}`],
    ["예상 최종 승점", `${p1(b.sim.expPts)}점`],
  ];
  if (b.value) rows.push(["스쿼드 가치 순위", `리그 ${b.value.of}개 팀 중 ${b.value.rank}위`]);
  if (b.seasonStats?.xg != null && b.seasonStats?.xga != null) {
    rows.push(["시즌 xG · xGA", `${b.seasonStats.xg.toFixed(1)} · ${b.seasonStats.xga.toFixed(1)}`]);
  }
  const body = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join("");
  const players = b.topPlayers.length
    ? `<p class="fine">팀 내 공격포인트 상위: ${b.topPlayers
        .map((p) => `<strong>${esc(p.name)}</strong> ${p.goals}골 ${p.assists}도움${p.xg != null ? ` (xG ${p.xg.toFixed(1)})` : ""}`)
        .join(" · ")}</p>`
    : "";
  return `<div class="tablecard"><table><tbody>${body}</tbody></table></div>${players}`;
}

function methodology(b: SoccerBrief): string {
  const core =
    b.model === "hybrid"
      ? "각 구단의 <b>시즌 전 스쿼드 가치</b>(밸류트랙 이적료 모델로 평가한 선수 몸값을 시너지 집계한 전력 지수)를 사전 전력으로 두고, 실제 경기 결과로 구단별 전력을 보정하는"
      : "실제 경기 결과로 구단별 공격·수비력을 추정하는";
  return `<div class="foot">
    <b>방법론 — 시뮬레이션 기반 예측.</b> ${core} 푸아송 득점 모델(Dixon-Coles 저득점 보정, 최근 경기 가중)로
    경기별 승·무·패 확률과 기대득점을 계산한다. 경기 전 예측은 킥오프 전에 고정 저장되며, 리뷰의 ‘경기 전 예측’은 그 기록이다.
    순위 확률은 현재 승점을 고정한 채 공개된 잔여 일정을 <b>2만 회 몬테카를로</b>로 시뮬레이션한 값이다(동률은 득실차·다득점 순).
    ${b.model === "hybrid" ? "2025/26~2026/27 빅5 리그 2,001경기 사후 검증에서 순위확률점수(RPS) 0.2025(기준선 0.2296)를 기록했다." : ""}
    수치는 추정치이며 실제 결과를 보장하지 않는다. 생성 ${esc(b.date)}.
  </div>`;
}

export function renderSoccerArticle(b: SoccerBrief, prose: SoccerProse): RenderedSoccerArticle {
  const title = buildTitle(b);
  const dek = buildDek(b);
  const teaser = buildTeaser(b);
  const p = b.preview;

  const bodyHtml = `${ARTICLE_STYLE}
<article class="kbo-article">
  <div class="brand">Blinkers · ${esc(b.leagueKo)} 매치 리포트</div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(prose.lede)}</p>
  <div class="byline"><span><b>${esc(b.ko)}</b></span><span>${esc(b.date)}</span><span>${esc(b.leagueKo)} ${b.standings.played}경기</span></div>

  ${heroSection(b)}

  <h2>Review · 지난 경기</h2>
  <div class="h2title">${esc(md(b.review.date))} vs ${esc(b.review.opp)}</div>
  ${reviewBlock(b)}
  <p>${esc(prose.recap)}</p>

  <h2>Preview · 다음 경기</h2>
  <div class="h2title">${p ? `${esc(p.kickoffKst)} vs ${esc(p.opp)} (${venue(p.home)})` : "다음 경기 일정 미정"}</div>
  ${p ? predChips(p.pred, p.opp) : ""}
  ${p && p.oppRank != null ? `<p class="fine">상대 ${esc(p.opp)}: ${p.oppRank}위 · 승점 ${p.oppPts ?? "—"}${p.oppLastFive ? ` · 최근 5경기 ${esc(p.oppLastFive)}` : ""}</p>` : ""}
  <p>${esc(prose.preview)}</p>

  <h2>Table · 순위 경쟁</h2>
  <div class="h2title">${esc(b.leagueKo)} 순위와 시즌 시뮬레이션</div>
  ${tableBlock(b)}
  <p>${esc(prose.table)}</p>

  <h2>Outlook · 전망</h2>
  <div class="h2title">시즌 전망</div>
  ${outlookBlock(b)}
  <p>${esc(prose.outlook)}</p>

  ${methodology(b)}
</article>`;

  return { title, dek, teaser, bodyHtml };
}
