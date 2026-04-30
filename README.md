# azz3 — Football Transfer Fee Predictor with Stat-Improvement Counterfactuals

Notebook MVP that predicts inbound-to-Premier-League transfer fees from prior-season FBref Big-5 stats and surfaces the top 3 stats whose improvement would have raised the predicted fee most.

Status: Weekend 1 implementation. Day 1 sample-size gate **PASSED** (551 joined rows). See `~/.gstack/projects/azz3/` for the full design doc + test plan.

## Background

Original plan called for live scraping of FBref + Transfermarkt. Hit four real-world walls during weekend 1, each surfaced and decided with the user:

- **I1:** soccerdata 1.8 dropped Transfermarkt → tried ScraperFC.
- **I2:** ScraperFC's TM transfer-history parser is broken → pivoted target to TM Market Value.
- **I3:** FBref blocked by Cloudflare for both soccerdata and ScraperFC → switched stats to Understat.
- **I4 (resolved):** Found `JaseZiv/worldfootballR_data` GitHub repo — refreshed RDS dumps of FBref + TM transfers + TM market values, served via raw GitHub URLs (no Cloudflare). Single download, no live scrape. **Reverts I2 and I3 entirely** — back to the original transfer-fee target with full FBref Big-5 stats.

Net data layer: download 8 RDS files (~12 MB total) from `JaseZiv/worldfootballR_data`, read with the pure-Python `rdata` library, JOIN by normalized name + prior season + age. No runtime scraping. Coverage: 2010-2023 stats, 2010-2022 transfers (~24K disclosed fees in EUR).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
brew install libomp   # macOS only — required by xgboost
```

## Layout

```
src/                 # testable modules
  config.py          # constants (SEASONS, leagues, MIN_TRAIN_N, fuzzy threshold...)
  data.py            # worldfootballR_data RDS download + JOIN
  match.py           # layered player ID matching (legacy from live-scrape plan)
  features.py        # statistical feature selection (LASSO + RFE + MI)
  model.py           # temporal split + player-disjoint + xgboost + drift metrics
  shap_utils.py      # TreeExplainer + ±1 SD perturbation rubric
tests/               # pytest, mirrors src/
tests/eval/          # SHAP rubric eval + held-out MAE regression
scripts/
  sanity_check.py    # Day 1 gate (download + JOIN + count)
  full_ingest.py     # legacy live-scrape (no longer used; kept for reference)
notebooks/           # demo / orchestration (TBD weekend 3)
data/                # local cache, .gitignored
```

## Workflow

### Day 1 (DONE)
```bash
.venv/bin/python scripts/sanity_check.py
# Expect: PASS, 551 joined rows, median fee €14.4M
```

### Weekend 2 (in progress)
- Feature selection on the joined transfer × prior-season-stats table
- Temporal split with player-disjoint enforcement (2014-2020 train, 2021-2022 test)
- Train xgboost + linear baseline; report MAE in €, Spearman ρ, pre/post-2020 drift
- SHAP TreeExplainer with top-3 ±1 SD perturbation per player

### Weekend 3
- Internal demo, screenshare to teammates

## Tests

```bash
.venv/bin/python -m pytest tests/ -v
```

Currently 11 passing tests covering the highest-risk paths.

## Scope

**In:** Inbound-to-PL transfers from Big 5 leagues, 2014-2022 disclosed-fee, prior-season FBref stats joined by name+age, SHAP-based "which stat to improve" counterfactual on top-3 stats per player.

**Out:** Live data refresh (depends on `worldfootballR_data` upstream), 2023+ transfers, players from non-Big-5 leagues without prior FBref Big-5 stats, best-destination recommender, web app, goalkeepers, public content, agent-side validation, CI. See design doc's "NOT in Scope" section.
