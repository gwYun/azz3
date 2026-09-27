# 밸류트랙 — 2026 Summer Transfer Destination & Fee Predictor

A destination-club recommender built on top of the existing `azz3` transfer-fee
model. For a handful of marquee players it produces, per player: a model-implied
**fee range** and a ranked list of **best-fit destination clubs** — then a Korean
press-release fragment. Run alongside the World Cup predictor in `worldcup/`.

## Why this is a new layer (not just the fee model)

The trained fee model (`data/models/xgb_transfer_fee.pkl`) has **no destination
feature** — `team_name` is excluded from its 29 inputs. So the same player yields
**one fee regardless of destination**. Predicting *where* a player goes is a
separate, empirical layer:

**(A) Empirical club-fit engine** (`src/club_profiles.py`)
- From the disclosed-fee Big-5 transfer history (`src.data.load_transfers`,
  2014–2022), builds a **buying profile** per destination club: position mix,
  nationality/source-league affinity, age band, typical spend, activity — all
  recency-weighted toward 2022.
- Scores a candidate player against each club. The **affordability gate**
  dominates (a club that never spends near a player's value is a poor fit).

**(C) Hybrid realism layers** (`src/recommender.py`)
- A soft, heavily-compressed **destination-league prior** (volume shouldn't let
  one league dominate prestige).
- A curated **2026 suitor shortlist + club-prestige weights**
  (`data/suitor_clubs_2026.json`) so recommendations stay among clubs plausibly
  active in July 2026, and marquee players don't all collapse onto whichever club
  has the single highest historical spend.

**Fee** (`src/fee_bridge.py`) reuses the model exactly as `worldcup/` does
(load → median-fill → predict → de-deflate). The displayed **range** is the model
point estimate with a band shaped by the chosen club's typical spend.

## Real 2025/26 stats

Player stats are the **2025/26** Stathead export ingested by
`src.data.load_stathead_2526()` (3,354 Big-5 players). That export is the FBref
*standard* table only, so xG/shooting are approximated from goals (a documented
heuristic — see `_proxy_shooting`).

## Run

```bash
python -m destination.scripts.run_recommender --top_k 5
# --no-distinct  to allow players to share the same top-1 club (raw ranking)
```

Outputs land in `destination/outputs/` (CSV + JSON) and `destination/report.md`.

## Featured players

Lamine Yamal, Pedri (FC Barcelona), Kylian Mbappé (Real Madrid). All three are
franchise cornerstones unlikely to actually move — the report frames the result
as *"model-implied value + best-fit destination if they were to move."*

## Limitations

- **Fee is buyer-aware** via one feature: a per-club fee/market-value premium
  crossed with the player's value, so high-value players cost more at clubs that
  historically pay above market value. The effect is muted for cheap players.
- **Club fit = historical buying propensity** (2014–2022), not insider info.
- **xG/shooting are goals-based proxies** → attacker fees are noisier.
- **Fees are re-inflated to 2026€**: the model trains in 2014€ (both MV input and
  fee target deflated), predicts, then re-inflates by the deflator extrapolated to
  2026 (~4.8×). The long extrapolation is the dominant uncertainty in the headline
  numbers.
- EUR→USD at a fixed **1.08**; league prior is an empirical prior, not a classifier.
