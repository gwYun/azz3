# 밸류트랙 — 월드컵 스타 예측 (2026 World Cup Breakout-Star Predictor)

After the 2026 World Cup, this module picks the players whose **market value jumped
most**, predicts their **transfer fee + best-fit destination**, and names the single
**"가장 유력한 하메스 케이스"** — a young breakout headed for a super-club, the way James
Rodríguez went Monaco → Real Madrid after 2014.

It is mostly an assembly of existing `azz3` pieces plus one new calibrated layer.

## Pipeline (all reuse except `wcstars/src`)

1. **`worldcup.src.squad_strength_v2.load_player_pool_2526`** — every Big-5-league World
   Cup player with 2025/26 club form + market value, valued by the shared XGBoost
   transfer-fee model (`data/models/xgb_transfer_fee.pkl`).
2. **`wcstars.src.tournament_data`** — attaches two real-tournament signals per player:
   - `E` nation exposure (how deep the nation went: champion > final > … > group),
   - `P` individual performance in [0,1] (FotMob "Top stats" overview + awards + curated
     movers).
3. **`wcstars.src.breakout`** — the breakout multiplier `M`, the value jump `V0→V1`, the
   ranked board, and the 하메스 archetype pick.
4. **`destination.src.recommender`** — feeds each top player's *boosted* profile (V1) to
   the buyer-aware fee + best-fit-destination engine.
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
- `historical_breakouts.json` — James-2014 calibration anchor + held-out 2026 movers.

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
- **Fees** — 2014-money model extrapolated to 2026 (~4.8× deflator); the destination is a
  best-fit "if they move", not a literal prediction (e.g. Manzambi actually joined Aston
  Villa, whereas the model's best fit is a super-club).
