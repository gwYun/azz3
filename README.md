# azz3 — ValueTrack (밸류트랙)

A sports valuation & prediction platform. Two data/modeling domains — **soccer**
(transfer-fee model, squad-strength sim engine, and the apps built on it) and **KBO
baseball** (sabermetric season/postseason sim) — feed a **Next.js web app** backed by
**Supabase**.

> The project began as a single soccer transfer-fee notebook and grew into several
> Python modules plus a production web app. It was reorganized into the layout below;
> see **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full system + data-flow map.

## Layout

```
azz3/
├── python/              # all Python (installed as one editable package: `valuetrack`)
│   ├── pyproject.toml
│   ├── core/            # soccer transfer-fee model        → import core.*
│   │   ├── config.py    # REPO_ROOT / DATA_DIR / WEB_* paths
│   │   └── cli/         # train · predict · explain · export_for_web · …
│   ├── soccer/
│   │   ├── engine/      # shared squad-strength / synergy / match sim engine
│   │   └── apps/        # worldcup (winner) · premier_league · worldcup_stars · destination
│   ├── kbo/             # self-contained KBO pipeline (src/ + scripts/)
│   ├── data/            # local model cache + trained model (gitignored)
│   ├── predictions/     # committed demo run artifacts
│   └── tests/           # pytest (covers core.* + kbo.src.*)
├── web/                 # Next.js 14 app (Vercel) — reads Supabase + exported JSON
├── supabase/            # Postgres migrations (auth, payments, kbo_*, soccer_*, api_tokens)
└── docs/                # design notes, model report, Open News API spec, assets/
```

The web app lives at the repo root (Vercel roots there and bundles an embedded Python
serverless function under `web/api/`). Python packages resolve `web/` via
`core.config.REPO_ROOT` (walks up to `.git`), so `python/` can move without breaking exports.

## Setup

```bash
# Python (CPython 3.9)
python3 -m venv .venv
.venv/bin/pip install -e "python/[dev]"      # installs core, soccer.*, kbo.* + dev tools
brew install libomp                           # macOS only — xgboost needs it

# Web
cd web && yarn install                        # Yarn 4 (Berry), Node >= 20
cp .env.example .env.local                    # fill in Supabase + KakaoPay keys
```

There is no more root `requirements.txt`; Python deps live in `python/pyproject.toml`.
`web/requirements.txt` is separate (it pins the Vercel Python serverless runtime).

## Running

```bash
# --- soccer core model (writes into web/public + web/api/model) ---
.venv/bin/python -m core.cli.train
.venv/bin/python -m core.cli.export_for_web
.venv/bin/python -m core.cli.export_real_players

# --- soccer sim apps ---
.venv/bin/python -m soccer.apps.worldcup.run_prediction --sims 1000000
.venv/bin/python -m soccer.apps.premier_league.run_prediction --sims 1000000
.venv/bin/python -m soccer.apps.worldcup_stars.run_stars
.venv/bin/python -m soccer.apps.destination.run_recommender

# --- KBO ---
.venv/bin/python -m kbo.scripts.run_prediction

# --- web (Next.js + local Python inference bridge) ---
cd web && yarn dev            # web only
cd web && yarn dev:full       # web + local Python model server
```

## Testing

```bash
.venv/bin/python -m pytest python/tests -v    # Python
cd web && yarn test                            # web (Vitest)
cd web && yarn typecheck && yarn build         # web type + build check
```

## More

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — full module map, data-flow, dual-runtime KBO note.
- **[docs/OPEN_API.md](docs/OPEN_API.md)** — token-authed read-only Open News API (v1).
- **[docs/model-report.md](docs/model-report.md)** — comprehensive transfer-fee model report.
- `CLAUDE.md` — repo conventions for AI-assisted work (gstack).
