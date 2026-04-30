"""Weekend 2 step 2: SHAP per-prediction explanations.

Loads the trained xgb model + feature list, picks N test-set players, and for
each one outputs the top-3 stats whose +/-1 SD perturbation would have raised
the predicted transfer fee most. Also runs the rubric (a)/(b)/(c) eval.
"""
from __future__ import annotations

import json
import logging
import pickle
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

import pandas as pd  # noqa: E402

from src import config  # noqa: E402
from src.data import (  # noqa: E402
    join_transfers_with_prior_season_stats,
    load_fbref_player_stats,
    load_transfers,
)
from src.shap_utils import top_k_stat_improvements, validate_rubric  # noqa: E402

# Position-appropriate expected feature sets used by the rubric.
EXPECTED_FOR_POSITION = {
    "forward": {"Gls", "Gls_Per", "G_minus_PK_Per", "G+A_Per", "xG_Expected", "npxG_Expected", "xG_Per", "npxG_Per"},
    "midfielder": {"Ast", "Ast_Per", "G+A_Per", "xAG_Expected", "xAG_Per", "xG+xAG_Per"},
    "defender": {"MP_Playing", "Starts_Playing", "Min_Playing", "CrdY", "CrdR"},
    "goalkeeper": set(),
    "unknown": set(),
}

PLAYER_SAMPLE_N = 5


def _position_group(pos_str: str) -> str:
    """Quickest TM-position-string -> {forward, midfielder, defender, ...} mapping."""
    if not isinstance(pos_str, str):
        return "unknown"
    p = pos_str.lower()
    if "forward" in p or "striker" in p or "winger" in p or "attack" in p:
        return "forward"
    if "midfield" in p:
        return "midfielder"
    if "back" in p or "defender" in p:
        return "defender"
    if "goalkeeper" in p or "keeper" in p:
        return "goalkeeper"
    return "unknown"


def main() -> int:
    model_path = config.MODELS_DIR / "xgb_transfer_fee.pkl"
    feats_path = config.MODELS_DIR / "selected_features.json"
    if not model_path.exists() or not feats_path.exists():
        print(f"Model artifacts not found. Run scripts/train.py first.")
        return 2

    with open(model_path, "rb") as f:
        model = pickle.load(f)
    with open(feats_path) as f:
        feats_meta = json.load(f)
    selected = feats_meta["features"]
    medians = pd.Series(feats_meta["medians"])

    # Reload test set + medians-fill, exactly like train.py.
    seasons = list(range(2014, 2023))
    transfers = load_transfers(seasons=seasons)
    stats = load_fbref_player_stats(seasons=seasons + [s + 1 for s in seasons])
    joined = join_transfers_with_prior_season_stats(transfers, stats, age_tolerance=2)

    test_seasons = {"2021", "2022"}
    test_df = joined[joined["season"].astype(str).isin(test_seasons)].copy().reset_index(drop=True)
    test_df[selected] = test_df[selected].fillna(medians)

    # Compute training-set feature stds for ±1 SD perturbation.
    train_df = joined[~joined["season"].astype(str).isin(test_seasons)].copy()
    train_df[selected] = train_df[selected].fillna(medians)
    feature_stds = train_df[selected].std()

    # Pick PLAYER_SAMPLE_N test-set players, biased toward larger fees so
    # the demo lands on names people recognize.
    sample = test_df.sort_values("transfer_fee", ascending=False).head(PLAYER_SAMPLE_N).copy()

    print("=" * 70)
    print("SHAP — Top-3 stats whose +/-1 SD change would have raised predicted fee most")
    print("=" * 70)

    rubric_summary = {"position_appropriate": 0, "monotonic": 0, "not_just_variance": 0}
    for _, row in sample.iterrows():
        name = row["player_name"]
        actual = row["transfer_fee"]
        season = row["season"]
        pos_group = _position_group(row.get("player_position", ""))
        pred = float(model.predict(pd.DataFrame([row[selected].values], columns=selected))[0])

        top3 = top_k_stat_improvements(model, row, selected, feature_stds, k=3)
        rubric = validate_rubric(model, row, selected, feature_stds,
                                 EXPECTED_FOR_POSITION.get(pos_group, set()))
        for k, v in rubric.items():
            if v:
                rubric_summary[k] += 1

        print()
        print(f"{name} ({pos_group}) — {season} transfer to {row['team_name']}")
        print(f"  actual fee:    €{actual/1e6:>6.1f}M")
        print(f"  predicted fee: €{pred/1e6:>6.1f}M")
        print(f"  to RAISE predicted fee, improve these stats most:")
        for s in top3:
            arrow = "↑" if s.direction == "+" else "↓"
            print(f"    {arrow} {s.feature:<22} (Δ +€{s.delta_eur/1e6:.2f}M predicted)")
        rubric_text = " | ".join(
            f"{k}={'✓' if v else '✗'}" for k, v in rubric.items()
        )
        print(f"  rubric: {rubric_text}")

    print()
    print("-" * 70)
    print(f"Rubric pass rate across {PLAYER_SAMPLE_N} sample players:")
    for k, v in rubric_summary.items():
        print(f"  {k}: {v}/{PLAYER_SAMPLE_N}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
