/**
 * Shared Vercel AI Gateway call for the article prose writers (KBO + soccer).
 *
 * Plain fetch to the Gateway's OpenAI-compatible endpoint (no SDK dependency in
 * the cron path). Auth via AI_GATEWAY_API_KEY; returns null when no key is set
 * so callers fall back to deterministic template prose. Throws on transport /
 * parse failure — callers catch and fall back the same way.
 */
const GATEWAY_URL =
  process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, "") ?? "https://ai-gateway.vercel.sh/v1";
const TIMEOUT_MS = 20_000;

/** Pull a JSON object out of a completion that may be fenced or prefaced. */
export function extractJsonObject(s: string): string | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

/**
 * One JSON-object chat completion. Resolves to the parsed object, or null when
 * the gateway key is not configured.
 */
export async function completeJson(
  model: string,
  system: string,
  user: string,
  { maxTokens = 2000, temperature = 0.7 }: { maxTokens?: number; temperature?: number } = {},
): Promise<unknown | null> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    const jsonStr = content ? extractJsonObject(content) : null;
    if (!jsonStr) throw new Error("no json object in completion");
    return JSON.parse(jsonStr);
  } finally {
    clearTimeout(timer);
  }
}
