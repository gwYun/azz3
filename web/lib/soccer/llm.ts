/**
 * Prose writer for the soccer match reports (via the shared AI Gateway call).
 * Writes ONLY the five narrative paragraphs from the deterministic brief; every
 * number on the page is rendered from the brief by article-template.ts. Falls
 * back to deterministic template prose on no key / error / malformed output so
 * the cron always publishes.
 */
import { completeJson } from "@/lib/llm-gateway";
import type { SoccerBrief, SoccerProse } from "./article-types";
import { SOCCER_PROSE_KEYS } from "./article-types";

const MODEL = process.env.SOCCER_ARTICLE_MODEL ?? process.env.KBO_ARTICLE_MODEL ?? "anthropic/claude-haiku-4.5";

const SYSTEM = [
  "당신은 축구 리그를 데이터로 분석하는 전문 칼럼니스트입니다.",
  "제공된 데이터 브리프(JSON)만을 근거로, 한 구단의 매치 리포트를 깊이 있고 분석적인 한국어로 씁니다.",
  "리포트는 지난 경기 리뷰(review)와 다음 경기 프리뷰(preview)를 함께 다룹니다.",
  "규칙:",
  "1) 브리프의 숫자·사실(스코어·순위·승점·확률·기대득점·추세)은 정확히 인용하세요. 브리프에 없는 득점자·선수 교체·경기 장면·부상 소식은 절대 지어내지 마세요. 선수 이름은 topPlayers에 있는 이름만 쓰세요.",
  "2) review.pred가 있으면 경기 전 모델 예측과 실제 결과를 비교하세요(review.hit=true면 적중, false면 이변). 없으면 비교하지 마세요.",
  "3) 확률은 시뮬레이션 추정치임을 전제로, 단정 대신 '모델은 ~로 본다' 식으로 서술하세요. 과장·감탄사 자제.",
  "4) 분량: lede 2~3문장, recap·preview·outlook 3~5문장, table 3~5문장.",
  '5) 반드시 JSON 객체 하나만 출력: {"lede","recap","preview","table","outlook"}.',
  "   lede = 지난 경기 결과와 현재 위치 요약.",
  "   recap = 지난 경기의 결과와 의미, 경기 전 예측 대비 평가.",
  "   preview = 다음 상대·홈원정·모델의 승무패 확률과 기대득점, 상대의 순위·최근 흐름.",
  "   table = table과 sim 근거로 순위 경쟁 구도(상위권/하위권 확률과 직전 리포트 대비 추세).",
  "   outlook = 남은 시즌 과제와 전망(스쿼드 가치 순위가 있으면 활용).",
  "6) 인사말·설명·코드블록 없이 JSON 객체 하나만 출력하세요.",
].join("\n");

function asProse(v: unknown): SoccerProse | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const out = {} as SoccerProse;
  for (const k of SOCCER_PROSE_KEYS) {
    const s = o[k];
    if (typeof s !== "string" || s.trim().length === 0) return null;
    out[k] = s.trim();
  }
  return out;
}

export async function writeSoccerProse(brief: SoccerBrief): Promise<{ prose: SoccerProse; model: string }> {
  try {
    const user = [`구단: ${brief.ko} (${brief.leagueKo}). 발행일: ${brief.date}.`, "아래 브리프의 사실만 사용하세요:", JSON.stringify(brief)].join("\n");
    const parsed = await completeJson(MODEL, SYSTEM, user);
    if (parsed === null) return { prose: fallbackSoccerProse(brief), model: "template" };
    const prose = asProse(parsed);
    if (!prose) throw new Error("malformed prose json");
    return { prose, model: MODEL };
  } catch (err) {
    console.error("[soccer-articles] prose fell back to template:", err instanceof Error ? err.message : err);
    return { prose: fallbackSoccerProse(brief), model: "template" };
  }
}

/** Deterministic, correct Korean from the brief — the no-key default and safety net. */
export function fallbackSoccerProse(b: SoccerBrief): SoccerProse {
  const s = b.standings;
  const r = b.review;
  const res = r.result === "W" ? "승리했다" : r.result === "L" ? "패했다" : "비겼다";
  const where = r.home ? "홈에서" : "원정에서";

  const lede = `${b.ko}가 ${where} ${r.opp}를 상대로 ${r.teamScore}-${r.oppScore}로 ${res}. ${s.played}경기를 치른 현재 승점 ${s.pts}점으로 ${b.leagueKo} ${s.rank}위에 올라 있다.`;

  let recap = `${b.ko}는 ${r.opp}전에서 ${r.teamScore}골을 넣고 ${r.oppScore}골을 내줬다.`;
  if (r.pred) {
    recap += ` 모델은 경기 전 이 경기의 승리 확률을 ${r.pred.win.toFixed(1)}%, 무승부 ${r.pred.draw.toFixed(1)}%로 봤고, 결과는 ${r.hit ? "예측과 일치했다" : "예측을 벗어났다"}.`;
  }

  let preview: string;
  if (b.preview) {
    const p = b.preview;
    preview = `다음 경기는 ${p.kickoffKst} ${p.home ? "홈" : "원정"} ${p.opp}전이다. 모델은 ${b.ko}의 승리 확률을 ${p.pred.win.toFixed(1)}%, 무승부 ${p.pred.draw.toFixed(1)}%, 패배 ${p.pred.loss.toFixed(1)}%로 추정하며, 기대득점은 ${p.pred.xgFor.toFixed(2)} 대 ${p.pred.xgAgainst.toFixed(2)}이다.`;
  } else {
    preview = `다음 경기 일정은 아직 공개되지 않았다.`;
  }

  const trend =
    b.sim.trendTop == null ? "" : b.sim.trendTop > 0 ? " 직전 리포트보다 상승했다." : b.sim.trendTop < 0 ? " 직전 리포트보다 하락했다." : "";
  const table = `시즌 시뮬레이션에서 ${b.ko}가 상위 ${b.zones.top}위 안에서 시즌을 마칠 확률은 ${b.sim.top.toFixed(1)}%다.${trend} 하위 ${b.zones.bottom}위로 마칠 확률은 ${b.sim.bottom.toFixed(1)}%로 집계됐다.`;

  const outlook = `남은 공개 일정 ${b.remainingFixtures}경기를 반영한 예상 최종 승점은 ${b.sim.expPts.toFixed(1)}점이다. 1위와의 승점 차는 ${s.gapLeader}점이며, 남은 경기 결과에 따라 확률은 크게 움직일 수 있다.`;

  return { lede, recap, preview, table, outlook };
}
