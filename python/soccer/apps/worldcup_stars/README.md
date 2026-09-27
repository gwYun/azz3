# 밸류트랙 — 월드컵 스타 예측 (2026 World Cup Star Predictor)

After the 2026 World Cup, this module builds a board of the tournament's **recognizable
stars**, shows **each player's WC stat line**, notes **real transfer rumors**, predicts
their **fee + destination clubs ranked by club value (구단가치)**, and still names the
single **"가장 유력한 하메스 케이스"** — a young, undervalued breakout headed for a
super-club, the way James Rodríguez went Monaco → Real Madrid after 2014.

The board is ranked by a **hybrid star score**, not pure value-jump: a famous player who
performed (Mbappé, Yamal, Bellingham) leads even though his value barely moves, while a
young riser with a real value jump surfaces in the upper-middle (see `breakout.py`
`STAR_*` constants). The 하메스 pick is a separate archetype pass that requires genuine
headroom, so a maxed-out €200M name can't be crowned the breakout.

It is mostly an assembly of existing `azz3` pieces plus one calibrated layer.

## Pipeline (all reuse except `wcstars/src`)

1. **`worldcup.src.squad_strength_v2.load_player_pool_2526`** — every Big-5-league World
   Cup player with 2025/26 club form + market value, valued by the shared XGBoost
   transfer-fee model (`data/models/xgb_transfer_fee.pkl`).
2. **`wcstars.src.tournament_data`** — attaches per-player signals:
   - `E` nation exposure (how deep the nation went: champion > final > … > group),
   - `P` individual performance in [0,1] (FotMob "Top stats" overview + awards + curated),
   - a **WC stat line** (goals/assists/apps/rating) and **notability** from
     `wc2026_player_stats.json`, and a **transfer rumor** from `wc2026_transfer_rumors.json`.
3. **`wcstars.src.breakout`** — the breakout multiplier `M`, the value jump `V0→V1`, the
   **star score** that ranks the board (recognizability × output), and the 하메스 pick.
4. **`destination.src.recommender`** — feeds each top player's *boosted* profile (V1) to
   the buyer-aware fee + destination engine; `run_stars` then **orders each player's
   destination list by 구단가치** (`destination/data/club_brand_values_2026.json`,
   enterprise value, largest first) rather than by fit.
5. **`wcstars.src.calibration`** — calibrates the multiplier level to James-2014 and
   validates out-of-sample against the real 2026 movers.

## The breakout multiplier

```
M = clip( 1 + K · spotlight · youth_factor · ceiling_factor , 1, M_MAX )
spotlight      = P · (1 + AMP_E · E)      # individual performance drives it; nation-run amplifies
youth_factor   # younger → bigger % jump (James was 22)
ceiling_factor # a player already valued near the top has little room (why Mbappé barely jumps)
V0             # pre-WC value (curated 2026 MV where available, else model value)
V1 = V0 · M    # jump = V1 − V0
```

`spotlight = P·(1+AMP_E·E)` makes **individual performance P the primary driver**: a
fringe squaddie on the champion (P=0) does not float up; a breakout needs real individual
spotlight (goals/assists/rating/award, or a curated real move).

## Calibration discipline (same rule as `kbo/src/salary_model.py`)

Only the **level** `K` is fit — to the James-2014 anchor (~1.67×). The factor *shapes*
are fixed a priori. The 2026 movers (Bouaddi, Manzambi, Koné) are **held out** and only
reported as validation; K is never tuned to them (that would be slope-fitting a censored
sample). Latest: James model ×1.67 vs target 1.67; movers within ~30% (the gap is the
destination buyer-premium, applied in the recommender step).

## Data (`wcstars/data/`)

- `wc2026_fotmob_topstats.json` — FotMob WC "Top stats" overview (top-3 per category).
  **robots note:** fotmob.com `robots.txt` is `Allow: /` with `Disallow: /api/*`; only the
  rendered overview page was read, never `/api/*`.
- `wc2026_results.json` — champion/finalists, per-nation stage reached, stage weights, awards.
- `wc2026_market_values.json` — curated pre-WC 2026 market values (jump baseline override).
- `wc2026_player_stats.json` — per-player WC stat line (G/A/apps/rating) + `notability` +
  curated `P` for the recognizable-star board. FotMob-sourced where the player is on a
  leaderboard, else a curated estimate flagged via `stat_source` (shown as `*` on the page).
- `wc2026_transfer_rumors.json` — curated summer-2026 transfer rumors/confirmed moves
  (display only; the real-world linked club is shown next to the model prediction).
- `historical_breakouts.json` — James-2014 calibration anchor + held-out 2026 movers
  (the ONLY rumor source that feeds calibration/validation).

## Run

```bash
.venv/bin/python -m wcstars.scripts.run_stars --top 16
```

Writes `outputs/breakout_rankings.csv`, `outputs/breakout_stars.json`,
`report.md` (Korean), and `web/public/worldcup-stars.json` (the `/worldcup-stars` page).
Validate/inspect the calibration alone with `python -m wcstars.src.calibration`.

## Limitations (disclosed in the report)

- **Big-5-league players only** — per-player valuation needs Big-5 club stats; non-Big-5
  World Cup stars are out of scope.
- **P is coarse** — the robots-clean FotMob source is top-3-per-category, so P covers the
  named leaderboard standouts + curated breakouts; everyone else is P=0.
- **Fees** — 2014-money model extrapolated to 2026 (~4.8× deflator).
- **Confirmed vs predicted destination** — a player with a *confirmed* real 2026 move shows
  the **actual club + real fee** (Manzambi → Aston Villa ✔, €70M), and is excluded from the
  하메스 pick (that pick is a forward prediction of a young breakout's super-club move, so it
  goes to an unsigned candidate like Bouaddi → Real Madrid). Unsigned players show the model
  best-fit "if they move". Update `data/historical_breakouts.json → actual_2026_movers` as
  real deals land.
