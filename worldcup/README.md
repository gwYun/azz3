# 밸류트랙 — 2026 World Cup Winner Prediction

A two-stage, **value-driven** predictor for the 2026 FIFA World Cup, built on top of
the existing `azz3` transfer-fee model. It produces three outputs and a Korean report.

## The two stages

**Stage 1 — Value & rank** (`src/squad_strength.py`, `src/synergy.py`)
- Reuses the trained XGBoost transfer-fee model (`data/models/xgb_transfer_fee.pkl`)
  to value each European-based player of every nation.
- Aggregates players into a team strength **with synergy** — not a plain sum:
  top-end concentration, spine completeness, positional diminishing returns, and
  club chemistry (the "combinations of players" effect).
- Blends the model signal with each nation's **full Transfermarkt squad value**
  (`data/tm_squad_values.json`) so non-European squads (Brazil, Argentina, …) aren't
  undervalued by the Big-5-only training data.
- → `outputs/stage1_rankings.csv`

**Stage 2 — PvP simulation** (`src/match_model.py`, `src/simulate.py`)
- Head-to-head outcomes are driven **purely by Stage-1 value ratings** (+ host
  advantage for USA/Mexico/Canada). Rating gap → expected goals → independent
  Poisson; knockout ties → strength-weighted shootout.
- Runs the **real 2026 bracket** (`data/groups_2026.json`) ~1,000,000 times
  (Monte-Carlo, fully numpy-vectorized over the simulation axis).
- → `outputs/sim_distribution.json`

## Three outputs (in `report.md`)

1. **나라별 우승 확률** — every nation's championship probability, summing to 100%.
2. **가장 유력한 4강 (1위→4위)** — the most-frequent exact final-four set, ordered.
3. **그 4강 시나리오의 확률** — the probability of that exact quartet occurring,
   cross-validated against the top-4-by-semifinal-probability.

## Run

```bash
python -m worldcup.scripts.run_prediction --sims 1000000 --seed 42
```

Outputs land in `worldcup/outputs/` and `worldcup/report.md`. Runtime ≈ 30s.

## Limitations

- Player-value snapshot is the **2022** Big-5 season (latest in the cached data).
- Non-Euro players enter only via the TM squad-value anchor, not per-player model
  valuation. The value-only driver intentionally excludes Elo/bookmaker odds.
- The 8-best-thirds → bracket-slot assignment uses a faithful greedy approximation
  of FIFA's official allocation table; aggregate distributions are unaffected.
