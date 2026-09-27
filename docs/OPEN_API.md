# azz3 Open News API (v1)

A small, **read-only** HTTP API that serves the daily-news content behind
ValueTrack / 밸류트랙 — KBO daily articles and soccer daily data — so a bot (e.g.
Claude) can turn it into **card news**.

This document is written to be handed directly to an AI agent (Claude or GPT).
If you are that agent: everything you need to fetch content and generate cards is
below, with runnable examples. Skim once, then jump to **§3 Try it now** and run.

---

## 1. Auth

Every `/api/v1/*` request needs a bearer token in the `Authorization` header:

```
Authorization: Bearer azz_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Tokens are issued by an **admin** in the console at `/admin/tokens`. Ask the
  project owner for one; the plaintext is shown only once at creation.
- A token carries the `reports:read` scope, which grants every endpoint here.
- The API bypasses the site's consumer paywall on purpose — it is a trusted
  channel. **Treat the token like a password.** Don't commit it, don't paste it
  into shared logs. If it leaks, an admin revokes it (takes effect immediately).

Error responses:

| Status | Meaning | Fix |
|-------:|---------|-----|
| `401`  | missing / malformed / unknown / revoked / expired token | check the header + token |
| `403`  | valid token, missing scope | ask the admin to re-issue with the scope |
| `400`  | bad param (team, date, league, limit) | fix the query |
| `404`  | no such article | try another team/date |
| `500`  | server error | retry; if it persists, tell the owner |

All responses are JSON. Errors look like `{ "error": "unauthorized", "detail": "…" }`.

---

## 2. Base URL

```
https://www.valuetrack.pro
```

This is the live production host — all endpoints below are ready to call against
it. (`valuetrack.pro` 308-redirects to `www.valuetrack.pro`; use the `www` form
so `curl` doesn't drop the `Authorization` header across the redirect.)

---

## 3. Try it now (copy-paste)

**For a human/agent at a terminal.** Paste your token once, then run any block.

```bash
# 1) Set your token (ask an admin for one; issued at /admin/tokens)
export AZZ_TOKEN="azz_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 2) Health check — a 200 with "authenticated_as" means the token is live
curl -s https://www.valuetrack.pro/api/v1 \
  -H "Authorization: Bearer $AZZ_TOKEN" | jq

# 3) Latest KBO report per team (full body — your card-news source)
curl -s https://www.valuetrack.pro/api/v1/kbo/reports \
  -H "Authorization: Bearer $AZZ_TOKEN" | jq '.data[0]'

# 4) One team's last 3 reports
curl -s "https://www.valuetrack.pro/api/v1/kbo/reports?team=HH&limit=3" \
  -H "Authorization: Bearer $AZZ_TOKEN" | jq '.data[] | {date, title, dek}'

# 5) EPL daily digest (scores, table, top scorers)
curl -s https://www.valuetrack.pro/api/v1/soccer/epl/daily \
  -H "Authorization: Bearer $AZZ_TOKEN" | jq '.data | {results: .results[0:3], top: .scorers[0:3]}'
```

**For Claude / GPT with a code tool.** Drop-in, self-contained — set the token
and run:

```javascript
const BASE = "https://www.valuetrack.pro";
const TOKEN = "azz_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // ← paste token

const get = async (path) => {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
};

// Verify the token, then pull today's KBO reports to turn into cards.
console.log(await get("/api/v1"));                       // { authenticated_as, endpoints, ... }
const { data } = await get("/api/v1/kbo/reports?limit=3");
for (const a of data) console.log(a.team_ko, "—", a.title, "\n", a.body_text.slice(0, 120));
```

A `200` with `"authenticated_as"` means you're in. A `401` means the token is
missing/wrong/expired; a `403` means it lacks the `reports:read` scope.

---

## 4. Endpoints

### 4.1 `GET /api/v1` — catalog / token check

Returns the API description and the token's name + scopes. Use it as a health
check.

### 4.2 `GET /api/v1/kbo/reports` — KBO daily articles (full body)

Query params (all optional):

| Param  | Type | Default | Notes |
|--------|------|---------|-------|
| `team` | franchise code | — | one of `SS LG KT HT OB HH NC LT SK WO` |
| `date` | `YYYY-MM-DD` | — | single day. With `team` and no range → that one article |
| `from` | `YYYY-MM-DD` | — | inclusive range start |
| `to`   | `YYYY-MM-DD` | — | inclusive range end |
| `limit`| int | `10` | max `60`; caps list responses |

Behavior:
- no `team`, no range → **latest article per team** (front-page feed)
- `team` only → that team's most-recent `limit` articles
- `team` + `date` (no `from`/`to`) → that one article (single object, not a list)
- `from`/`to` (with or without `team`) → every article in the range, newest first,
  across all teams when `team` is omitted
- `date` alone (no `team`) → shorthand for `from=to=date` (that day, all teams)

Invalid or inverted ranges (`from` > `to`) return `400`.

```bash
# Latest per team
curl -s https://www.valuetrack.pro/api/v1/kbo/reports -H "Authorization: Bearer $AZZ_TOKEN" | jq

# Hanwha, last 5
curl -s "https://www.valuetrack.pro/api/v1/kbo/reports?team=HH&limit=5" -H "Authorization: Bearer $AZZ_TOKEN" | jq

# One specific article
curl -s "https://www.valuetrack.pro/api/v1/kbo/reports?team=HH&date=2026-09-27" -H "Authorization: Bearer $AZZ_TOKEN" | jq

# A whole week, all teams (newest first, up to `limit`)
curl -s "https://www.valuetrack.pro/api/v1/kbo/reports?from=2026-09-20&to=2026-09-27&limit=40" -H "Authorization: Bearer $AZZ_TOKEN" | jq

# One team across a range
curl -s "https://www.valuetrack.pro/api/v1/kbo/reports?team=HH&from=2026-09-01&limit=30" -H "Authorization: Bearer $AZZ_TOKEN" | jq
```

### 4.3 `GET /api/v1/kbo/reports/{team}/{date}` — one article

Path-param twin of the above. `team` = franchise code, `date` = `YYYY-MM-DD`.

```bash
curl -s https://www.valuetrack.pro/api/v1/kbo/reports/HH/2026-09-27 -H "Authorization: Bearer $AZZ_TOKEN" | jq
```

### 4.4 `GET /api/v1/soccer/{league}/daily` — soccer daily digest

Soccer leagues have **data, not written articles** — this endpoint returns the
raw material (results, table, leaders) so you compose the cards yourself.

`league` ∈ `epl · primera · bundesliga · seria · ligue1 · kleague · kleague2`

| Param  | Type | Default | Notes |
|--------|------|---------|-------|
| `date` | `YYYY-MM-DD` | latest | single match day (shorthand for `from=to=date`) |
| `from` | `YYYY-MM-DD` | — | inclusive range start (scopes results + upcoming) |
| `to`   | `YYYY-MM-DD` | — | inclusive range end |
| `limit`| int | `10` | max `50`; caps results + upcoming lists |

`standings`, `scorers`, and `assisters` are season-to-date and ignore the range;
`from`/`to`/`date` scope only the `results` and `upcoming` game lists.

```bash
# Latest
curl -s https://www.valuetrack.pro/api/v1/soccer/epl/daily -H "Authorization: Bearer $AZZ_TOKEN" | jq

# One match day
curl -s "https://www.valuetrack.pro/api/v1/soccer/epl/daily?date=2026-09-27" -H "Authorization: Bearer $AZZ_TOKEN" | jq

# A date range
curl -s "https://www.valuetrack.pro/api/v1/soccer/epl/daily?from=2026-09-20&to=2026-09-27&limit=20" -H "Authorization: Bearer $AZZ_TOKEN" | jq
```

---

## 5. Response shapes

Every success is wrapped in an envelope:

```json
{
  "data": <payload>,
  "meta": { "source": "azz3 Open News API v1", "attribution": "밸류트랙 (ValueTrack)", ... }
}
```

**`meta.attribution` must be shown on published cards.**

### KBO article object (`data`, or each item of a `data` array)

```json
{
  "league": "kbo",
  "team": "HH",
  "team_ko": "한화",
  "team_en": "Hanwha Eagles",
  "date": "2026-09-27",
  "title": "한화, 가을을 향한 전력질주",
  "dek": "한 줄 요약 / 부제",
  "teaser": { /* 카드용 칩·숫자 (구조는 기사마다 다름) */ },
  "brief": { /* 기사 생성에 쓰인 결정적 데이터 브리프 (출처·추세) */ },
  "body_html": "<p>…full article…</p>",
  "body_text": "…full article as plain text…",
  "model": "…",
  "published_at": "2026-09-27T18:00:00.000Z",
  "web_url": "/kbo/news/HH/2026-09-27",
  "locked": true
}
```

- `body_text` is the HTML flattened to prose — usually the easiest field to
  turn into card copy.
- `teaser` and `brief` are structured JSON (chips + a provenance/trend data
  brief) — great for **stat cards**. Shapes vary by article; treat them as
  optional and read defensively.
- `locked` is only the *website's* paywall state (informational). Your token
  always gets the full body.

### Soccer digest object (`data`)

```json
{
  "league": "epl",
  "results":  [ { "date": "2026-09-27", "round": "7R", "home": "브라이턴", "away": "첼시", "score": "2-1", "home_score": 2, "away_score": 1, "winner": "HOME" } ],
  "upcoming": [ { "date": "2026-10-04", "kickoff": "…", "round": "8R", "home": "…", "away": "…" } ],
  "standings":[ { "rank": 1, "team": "아스날", "played": 7, "wins": 6, "draws": 1, "losses": 0, "points": 19, "goals_for": 15, "goals_against": 4, "goal_diff": 11, "form": "WWWDW" } ],
  "scorers":  [ { "player": "…", "team": "…", "goals": 8, "assists": 2, "matches": 7 } ],
  "assisters":[ { "player": "…", "team": "…", "assists": 6, "goals": 1, "matches": 7 } ]
}
```

`meta` carries `league_ko`, `league_en`, `country`, `season`.

---

## 6. Recipe — generate card news with Claude

A card-news set is typically a title card + 4–8 content cards. Suggested mapping:

**From a KBO article**
1. **Cover card** — `team_ko` + `title`. Subtitle = `dek`.
2. **Stat cards** — pull 2–4 numbers from `teaser` / `brief` (one big number +
   label per card).
3. **Story cards** — split `body_text` into 2–4 beats; ~2 short sentences each.
   Rewrite for a card voice; don't paste raw paragraphs.
4. **Footer card** — date (`date`) + attribution (`meta.attribution`) + a
   pointer to `web_url`.

**From a soccer digest**
1. **Cover** — `league_ko` + match day / date.
2. **Results cards** — one scoreline per card from `results` (`home score away`).
3. **Table card** — top 5 of `standings` (rank · team · points · form).
4. **Leaders card** — top 3 `scorers` (and/or `assisters`).
5. **Footer** — attribution + upcoming fixtures teaser from `upcoming`.

Guidelines:
- Keep card text short — headlines ≤ ~14 Korean chars, body ≤ ~2 lines.
- Numbers are the hook. Prefer one dominant figure per stat card.
- Always credit `meta.attribution` and keep dates accurate (`date`, not "today").
- Don't invent facts. If a field is missing, drop that card rather than guess.

---

## 7. Fetch example (TypeScript)

```ts
const BASE = "https://www.valuetrack.pro";
const TOKEN = process.env.AZZ_TOKEN!;

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Latest KBO articles → card decks
const { data: articles } = await api<{ data: any[] }>("/api/v1/kbo/reports");
for (const a of articles) {
  console.log(a.team_ko, a.title, "→", a.body_text.slice(0, 80));
}

// EPL digest
const { data: epl } = await api<{ data: any }>("/api/v1/soccer/epl/daily");
console.log(epl.standings.slice(0, 5));
```

---

## 8. Etiquette & limits

- The API is read-only and cache-friendly; still, **don't hammer it** — poll
  once per generation run, not in a tight loop.
- There is no hard rate limit yet, but every request is logged against your
  token (`last_used_at`, `request_count`). Abnormal volume may get a token
  revoked.
- Content updates nightly (a cron refreshes articles + soccer data). Fetching
  more than a couple times a day rarely surfaces anything new.

---

## 9. For admins — issuing & revoking tokens

- Go to **`/admin/tokens`** (staff only — gated on `profiles.is_admin`).
- **발급**: enter a name/purpose + optional expiry → the plaintext token is shown
  **once**. Copy it and hand it to the consumer over a secure channel.
- **폐기**: click 폐기 next to a token; it's rejected on the very next request.
- Only the SHA-256 hash is stored, so the DB never holds a usable token.
- Prefer a CLI/script issuance path? The same primitives live in
  `web/lib/api-auth/token.ts` (`mintToken`, `hashToken`) — insert a row with the
  hash + prefix directly via the service role.
