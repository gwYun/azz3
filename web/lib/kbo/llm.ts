/**
 * Prose writer for the daily KBO articles, via the Vercel AI Gateway.
 *
 * HYBRID by design: the model receives the deterministic data brief and writes
 * ONLY the four narrative paragraphs. Every authoritative number is rendered
 * later from the brief by article-template.ts, so the model can never surface a
 * wrong figure as fact. If no gateway key is configured — or the call errors,
 * times out, or returns malformed JSON — we fall back to deterministic
 * template prose so the nightly cron ALWAYS publishes.
 *
 * We call the Gateway's OpenAI-compatible endpoint with a plain fetch (no SDK
 * dependency in the cron path). Auth via AI_GATEWAY_API_KEY; on a Vercel deploy
 * the Gateway can also authenticate with the project OIDC token, but the key is
 * the portable path and what we read here. Model + endpoint are env-overridable.
 */
import type { ArticleBrief, ArticleProse } from "./article-types";
import { PROSE_KEYS } from "./article-types";

const GATEWAY_URL =
  process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, "") ?? "https://ai-gateway.vercel.sh/v1";
// Light model is plenty — the template carries structure + numbers. Swap via env
// (verify the exact slug in your AI Gateway; a bad slug just triggers the fallback).
const MODEL = process.env.KBO_ARTICLE_MODEL ?? "anthropic/claude-haiku-4.5";
const TIMEOUT_MS = 20_000;

const SYSTEM = [
  "당신은 한국 프로야구(KBO) 가을야구 레이스를 심층 분석하는 전문 칼럼니스트입니다.",
  "제공된 데이터 브리프(JSON)만을 근거로, 깊이 있고 분석적인 한국어 기사를 씁니다.",
  "가장 중요한 임무: 이 팀의 경기뿐 아니라 raceContext(리그 10개 팀의 순위·전날 결과·각 팀의 PO 확률·5위 승차)를",
  "적극 활용해, 어제 다른 팀들의 승패가 이 팀의 가을야구(5위 이내) 진출 확률에 어떤 영향을 줬는지 구체적으로 분석하세요.",
  "규칙:",
  "1) 브리프에 있는 숫자·사실(점수·순위·승차·확률·추세)은 정확히 인용해 분석에 적극 활용하세요. 단, 브리프에 없는 수치·선수 이름·세부 장면(적시타·홈런 등)은 절대 지어내지 마세요.",
  "2) 신뢰감 있는 정통 스포츠 기사 문체. 과장·감탄사·추측 자제, 데이터에 근거한 분석 위주.",
  "3) 각 문단은 충분히 길고 구체적으로 씁니다: recap·preview·outlook은 3~5문장, race는 4~6문장, lede는 2~3문장.",
  '4) 반드시 JSON 객체 하나만 출력: {"lede","recap","preview","race","outlook"}.',
  "   lede = 팀의 현재 순위·PO 확률 흐름을 요약한 도입부.",
  "   recap = 어제 이 팀의 경기 결과와 그 의미(투타 흐름을 브리프 범위에서만).",
  "   preview = 오늘 상대·홈원정·예상 승부처.",
  "   race = raceContext 근거로 5위 커트라인 경쟁 구도를 분석. 특히 어제 경쟁 팀들의 승패가 이 팀의 진출 확률(전일 대비 추세 포함)을 어떻게 움직였는지 팀 이름과 함께 구체적으로.",
  "   outlook = 잔여 일정 기준 남은 과제와 전망.",
  "5) 인사말·설명·사과·코드블록(```) 없이 JSON 객체 하나만 출력하세요.",
].join("\n");

/** Pull a JSON object out of a completion that may be fenced or prefaced. */
function extractJsonObject(s: string): string | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

function userPrompt(brief: ArticleBrief): string {
  return [
    `팀: ${brief.ko} (${brief.en}). 날짜: ${brief.date}.`,
    "아래 브리프의 사실만 사용하세요:",
    JSON.stringify(brief),
  ].join("\n");
}

/** Coerce an unknown parsed value into a valid ArticleProse, or null. */
function asProse(v: unknown): ArticleProse | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const out = {} as ArticleProse;
  for (const k of PROSE_KEYS) {
    const s = o[k];
    if (typeof s !== "string" || s.trim().length === 0) return null;
    out[k] = s.trim();
  }
  return out;
}

/**
 * Write the four narrative paragraphs. Returns the prose and the model id that
 * produced it ("template" when the deterministic fallback ran).
 */
export async function writeArticleProse(
  brief: ArticleBrief,
): Promise<{ prose: ArticleProse; model: string }> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return { prose: fallbackProse(brief), model: "template" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(brief) },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    const jsonStr = content ? extractJsonObject(content) : null;
    if (!jsonStr) throw new Error("no json object in completion");
    const prose = asProse(JSON.parse(jsonStr));
    if (!prose) throw new Error("malformed prose json");
    return { prose, model: MODEL };
  } catch (err) {
    console.error("[kbo-articles] prose fell back to template:", err instanceof Error ? err.message : err);
    return { prose: fallbackProse(brief), model: "template" };
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------- //
// Deterministic fallback — plain, correct Korean sentences from the brief.     //
// This is the no-key default and the safety net, so keep it presentable.       //
// --------------------------------------------------------------------------- //
export function fallbackProse(b: ArticleBrief): ArticleProse {
  const s = b.standings;
  const cut = s.inPlayoffSpot
    ? `현재 ${s.rank}위로 가을야구 마지노선 안쪽에 있다`
    : `현재 ${s.rank}위로 5위와 승차를 좁혀야 하는 위치다`;

  const lede = `${b.ko}가 ${b.date} 기준 정규시즌 ${s.gamesPlayed}경기를 치르며 ${cut}. 잔여 ${s.gamesRemaining}경기의 결과에 가을야구 향방이 달려 있다.`;

  let recap: string;
  if (b.yesterday) {
    const y = b.yesterday;
    const verb = y.result === "W" ? "승리했다" : y.result === "L" ? "패했다" : "비겼다";
    const venue = y.home ? "홈에서" : "원정에서";
    recap = `전날 ${b.ko}는 ${venue} ${y.opp}를 상대로 ${verb}. 이날 결과는 순위 싸움의 흐름을 가르는 한 판이었다.`;
  } else {
    recap = `전날 ${b.ko}는 경기가 없었다. 팀은 다음 일정을 준비하며 컨디션을 조율했다.`;
  }

  let preview: string;
  if (b.today) {
    const t = b.today;
    const venue = t.home ? "홈에서" : "원정에서";
    preview = `오늘 ${b.ko}는 ${venue} ${t.opp}와 맞붙는다. 모델은 이 경기를 팽팽한 승부로 보고 있으며, 선취점과 불펜 운용이 승부처가 될 전망이다.`;
  } else {
    preview = `오늘 ${b.ko}는 예정된 경기가 없다. 순위 경쟁 상대들의 결과가 간접적으로 팀의 위치에 영향을 준다.`;
  }

  const dir =
    b.trendPlayoff == null
      ? "큰 변동이 없었다"
      : b.trendPlayoff > 0
        ? "상승했다"
        : b.trendPlayoff < 0
          ? "하락했다"
          : "유지됐다";
  const cutT = b.raceContext.find((t) => t.rank === 5);
  const race = `가을야구 5위 경쟁은 ${cutT ? `${cutT.ko}가 커트라인에 선 가운데 ` : ""}치열하게 전개되고 있다. 전날 경쟁 팀들의 승패가 맞물리며 ${b.ko}의 진출 확률은 전일 대비 ${dir}. 순위가 촘촘한 만큼 직접 상대와의 잔여 맞대결 결과가 셈법을 좌우할 전망이다.`;

  const trendTail =
    b.trendPlayoff == null
      ? ""
      : b.trendPlayoff > 0
        ? " 최근 흐름은 상승세다."
        : b.trendPlayoff < 0
          ? " 최근 흐름은 하락세다."
          : "";
  const outlook = `잔여 일정과 전력을 반영한 조건부 시뮬레이션은 ${b.ko}의 가을야구 진출 가능성을 산출한다.${trendTail} 남은 ${s.gamesRemaining}경기에서의 승패가 확률을 크게 움직일 것이다.`;

  return { lede, recap, preview, race, outlook };
}
