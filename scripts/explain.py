"""SHAP per-prediction explanations.

Loads the trained xgb model + selected features (now enriched: market value,
age curve, position, contract, multi-season), picks N test-set players, and
for each one outputs the top-3 stats whose +/-1 SD perturbation would have
raised the predicted transfer fee most. Reports nominal-EUR deltas (the
predictor wrapper inverts the log-deflated training target). Also runs the
rubric (a)/(b)/(c) eval.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

import pandas as pd  # noqa: E402

from scripts.predict import (  # noqa: E402
    Artifacts,
    _NominalPredictor,
    _load_artifacts,
    _prepare_feature_frame,
)
from scripts.train import prepare_dataset  # noqa: E402
from src.shap_utils import top_k_stat_improvements, validate_rubric  # noqa: E402


# Position-appropriate expected feature sets used by the rubric. Names are the
# ORIGINAL (pre-rename) feature names so they match the inverse_rename output.
EXPECTED_FOR_POSITION = {
    "forward": {
        "Gls", "Gls_Per", "G_minus_PK_Per", "G+A_Per", "xG_Expected", "npxG_Expected",
        "xG_Per", "npxG_Per", "Sh_Standard_shoot", "SoT_per_90_Standard_shoot",
        "G+A_minus_PK_Per", "pos_forward",
    },
    "midfielder": {
        "Ast", "Ast_Per", "G+A_Per", "xAG_Expected", "xAG_Per", "xG+xAG_Per",
        "Ast_pass", "A_minus_xA_pass", "Cmp_percent_Long_pass", "pos_midfielder",
    },
    "defender": {
        "MP_Playing", "Starts_Playing", "Min_Playing", "CrdY", "CrdR", "pos_defender",
        "prior_market_value_eur",
    },
    "goalkeeper": set(),
    "unknown": set(),
}

PLAYER_SAMPLE_N = 5


def _position_group(pos_str: str) -> str:
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
    art: Artifacts = _load_artifacts()
    joined = prepare_dataset()

    test_seasons = {"2021", "2022"}
    test_df = joined[joined["season"].astype(str).isin(test_seasons)].copy().reset_index(drop=True)
    X_test = _prepare_feature_frame(art, test_df)

    feat_stds = art.stds.reindex(art.features).fillna(1.0)

    # Pick top-N by actual fee for a recognizable sample.
    order = test_df["transfer_fee"].sort_values(ascending=False).index[:PLAYER_SAMPLE_N]
    sample_rows = test_df.loc[order].copy()
    sample_X = X_test.loc[order].copy()

    # Map xgb-safe feature names back to originals for rubric checks.
    inv = art.inverse_rename or {f: f for f in art.features}
    expected_xgb_keyed = {
        grp: {f for f in art.features if inv.get(f, f) in feat_set}
        for grp, feat_set in EXPECTED_FOR_POSITION.items()
    }

    print("=" * 78)
    print("SHAP — Top-3 stats whose +/-1 SD change would have raised predicted fee most")
    print("=" * 78)

    rubric_summary = {"position_appropriate": 0, "monotonic": 0, "not_just_variance": 0}
    for orig_idx, row_meta in sample_rows.iterrows():
        row_X = sample_X.loc[orig_idx]
        season = str(row_meta["season"])
        name = row_meta["player_name"]
        actual = float(row_meta["transfer_fee"])
        pos_group = _position_group(row_meta.get("player_position", ""))

        nominal_model = _NominalPredictor(art, season)
        pred = float(nominal_model.predict(pd.DataFrame([row_X.values], columns=art.features))[0])

        top3 = top_k_stat_improvements(nominal_model, row_X, art.features, feat_stds, k=3)
        rubric = validate_rubric(nominal_model, row_X, art.features, feat_stds,
                                 expected_xgb_keyed.get(pos_group, set()))
        for k, v in rubric.items():
            if v:
                rubric_summary[k] += 1

        print()
        print(f"{name} ({pos_group}) — {season} transfer to {row_meta['team_name']}")
        print(f"  actual fee:    €{actual/1e6:>6.1f}M")
        print(f"  predicted fee: €{pred/1e6:>6.1f}M")
        print(f"  to RAISE predicted fee, improve these stats most:")
        for s in top3:
            arrow = "↑" if s.direction == "+" else "↓"
            feat_label = inv.get(s.feature, s.feature)
            print(f"    {arrow} {feat_label:<32} (Δ +€{s.delta_eur/1e6:.2f}M predicted)")
        rubric_text = " | ".join(
            f"{k}={'✓' if v else '✗'}" for k, v in rubric.items()
        )
        print(f"  rubric: {rubric_text}")

    print()
    print("-" * 78)
    print(f"Rubric pass rate across {PLAYER_SAMPLE_N} sample players:")
    for k, v in rubric_summary.items():
        print(f"  {k}: {v}/{PLAYER_SAMPLE_N}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
