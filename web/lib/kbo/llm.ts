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
  "당신은 한국 프로야구(KBO) 전문 데일리 칼럼니스트입니다.",
  "주어진 데이터 브리프(JSON)만을 근거로 한국어 기사 문단을 씁니다.",
  "규칙:",
  "1) 숫자(확률·점수·순위·게임차 등)는 본문에서 반복하지 마세요. 수치는 기사 레이아웃이 별도로 표시합니다.",
  "2) 브리프에 없는 사실·선수·경기를 지어내지 마세요.",
  "3) 담백하고 신뢰감 있는 스포츠 기사 문체. 과장·감탄사 자제.",
  "4) 각 문단 2~4문장.",
  '5) 반드시 JSON 객체로만 답하세요: {"lede","recap","preview","outlook"}.',
  "   lede=오늘 기사의 핵심 훅, recap=어제 경기, preview=오늘 경기 관전포인트, outlook=가을야구 레이스 전망.",
].join("\n");

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
        max_tokens: 700,
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
    if (!content) throw new Error("empty completion");
    const prose = asProse(JSON.parse(content));
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

  let outlook: string;
  const trend =
    b.trendPlayoff == null
      ? ""
      : b.trendPlayoff > 0
        ? " 최근 흐름은 상승세다."
        : b.trendPlayoff < 0
          ? " 최근 흐름은 하락세다."
          : "";
  outlook = `잔여 일정과 전력을 반영한 시뮬레이션은 ${b.ko}의 가을야구 진출 가능성을 산출한다.${trend} 남은 ${s.gamesRemaining}경기에서의 승패가 확률을 크게 움직일 것이다.`;

  return { lede, recap, preview, outlook };
}
