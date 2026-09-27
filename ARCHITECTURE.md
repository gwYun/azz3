# Architecture

How the pieces of azz3 / ValueTrack fit together: the Python modeling side, the Next.js
web app, Supabase, and the data flow that connects them.

## The two halves

1. **Python research/modeling** (`python/`) — trains models and runs Monte-Carlo sims
   offline; hands results to the web app as committed JSON + one exported model.
2. **Web operational** (`web/` + `supabase/`) — a Next.js app that also *ingests* live
   KBO/soccer data nightly (TypeScript, via Vercel Cron) into Supabase and serves it.

The only coupling from Python → web is (a) JSON written into `web/public` + `web/api/model`,
and (b) the exported model run by `web/api/predict.py`. Nothing in `web/` imports the Python
packages, so the two halves version independently.

## Python packages (`python/`)

Installed as one editable package (`valuetrack`, see `python/pyproject.toml`). Imports are
absolute; there are no `sys.path` hacks.

```
core/                 fee-model foundation (config, data, enrich, features, model, shap_utils, match)
  └── cli/            train · predict · explain · export_for_web · export_real_players · sanity_check
soccer/
  ├── engine/         shared sim engine: squad_strength(_v2), synergy, match_model, simulate
  └── apps/           thin apps built on the engine + core:
      ├── worldcup/         World Cup *winner* Monte-Carlo
      ├── premier_league/   PL table Monte-Carlo
      ├── worldcup_stars/   breakout-*player* board (uses engine + destination + core)
      └── destination/      transfer fee + best-fit-club recommender (uses core model)
kbo/                  self-contained KBO pipeline (own config/data; does NOT import core)
```

Dependency direction: `core` ← `soccer.engine` ← `soccer.apps.{premier_league, worldcup_stars}`;
`core` ← `soccer.apps.destination` ← `soccer.apps.worldcup_stars`. `kbo` is an island.

**Repo-root resolution.** `core.config` splits two roles that used to be one `PROJECT_ROOT`:
`DATA_DIR`/`PREDICTIONS_DIR` live under `python/`, while `WEB_PUBLIC`/`WEB_API_MODEL` resolve
from `REPO_ROOT` (found by walking up to `.git`). `kbo/src/config.py` duplicates the 6-line
`_find_repo_root` helper on purpose, to stay self-contained.

## Web app (`web/`)

Next.js 14 App Router, TypeScript, Tailwind, Supabase SSR, Vitest. Reorganized into feature
folders:

- `lib/supabase/` (browser/server/admin clients), `lib/kbo/` (the deep KBO domain: sabermetrics,
  sims, articles, ingest, + `kbo-salary`, `matchup-sim`), `lib/soccer/`, `lib/news/`,
  `lib/pay/` (KakaoPay: kakaopay, pay-logic, pay-repo, pay-terminal), `lib/api-auth/` +
  `lib/api-v1/` (the Open News API). Cross-cutting singletons stay at `lib/` root
  (i18n, format, storage, credits, hooks, contexts, types).
- `components/{shared,auth,pay,build,kbo,admin}/` — grouped by domain.
- `app/` route tree is unchanged (public URLs are a contract).

### Data paths the web app reads
1. **Supabase (Postgres)** — primary: auth/session, payments/credits, and ingested
   `kbo_*` / `soccer_*` tables + `api_tokens`.
2. **Python model** — `web/api/predict.py` (Vercel Python serverless) runs the exported
   xgboost model; dev proxies to a local server (`yarn dev:full`).
3. **Static JSON in `web/public/`** — `kbo.json`, `worldcup*.json`, `transfers.json`,
   `players.json`, `model-info.json`, … produced by the Python export scripts.

## Supabase (`supabase/`)

Migrations cover: auth/profiles, payments/orders, credits/entitlements, KBO
(games/stats/boxscores/sim/articles), soccer (teams/games/standings/players/sim), and
`api_tokens` (SHA-256-hashed bearer tokens for the Open News API). All owned by the web app.

## Deployment

Web app → Vercel. Two **Vercel Cron** jobs (`web/vercel.json`): `/api/cron/kbo-daily`
and `/api/cron/soccer-daily` run the TypeScript ingest (`web/lib/{kbo,soccer}/ingest.ts`)
→ write Supabase → log runs. The Python sim apps are **run manually** and their outputs
committed. (Supabase migrations are applied via `supabase db push`; wire this into CI —
`.github/` is currently minimal.)

## Data flow

```
RAW SOURCES            PYTHON (offline, manual)          STORAGE                WEB
worldfootballR RDS  →  core (join/features/model)     →  data/models/*.pkl  →  web/api/predict.py
                       core.cli.export_*                  + web/*.json          + web/public/*.json
squad values        →  soccer.engine + soccer.apps    →  web/public/*.json  →  pages read JSON
Naver Sports (live) →  web/lib/{kbo,soccer}/ingest    →  Supabase kbo_*/    →  pages + /api/v1
                       (TypeScript, Vercel Cron)          soccer_*              (Open News API)
```

## Dual-runtime KBO (a deliberate duplication)

The KBO sabermetrics + Markov run-expectancy sim exist **twice**: Python (`python/kbo/`,
the offline "truth" used for backtests) and TypeScript (`web/lib/kbo/`, the web/cron
runtime). They are kept in lockstep by parity fixtures generated from the Python side
(`web/lib/kbo/__fixtures__/sabermetrics-parity.json`, `web/lib/kbo/__fixtures__/markov-parity.json`).

**Canonical:** the Python `kbo/` implementation is the reference; the TypeScript port must
match it to fixture precision. When changing KBO math, update Python first, regenerate the
fixtures, then port to TypeScript.
