"""Generate predictions and write CSVs to predictions/.

Three outputs:
  1. predictions/test_set.csv — every row in the held-out test set with
     actual fee, predicted fee, residual, and top-3 stat-improvement targets.
  2. predictions/sample_top.csv — the 10 highest-fee test transfers as a
     readable demo slice.
  3. predictions/fake_player.csv — a synthetic player profile, prediction,
     and SHAP top-3.
"""
from __future__ import annotations

import json
import logging
import pickle
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("predict")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src import config  # noqa: E402
from src.data import (  # noqa: E402
    join_transfers_with_prior_season_stats,
    load_fbref_player_stats,
    load_transfers,
)
from src.shap_utils import top_k_stat_improvements  # noqa: E402

PREDICTIONS_DIR = config.PROJECT_ROOT / "predictions"
PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)


def _load_artifacts():
    model_path = config.MODELS_DIR / "xgb_transfer_fee.pkl"
    feats_path = config.MODELS_DIR / "selected_features.json"
    if not model_path.exists() or not feats_path.exists():
        sys.exit("Run scripts/train.py first to produce model artifacts.")
    with open(model_path, "rb") as f:
        model = pickle.load(f)
    with open(feats_path) as f:
        meta = json.load(f)
    return model, meta["features"], pd.Series(meta["medians"])


def _format_top3(top3) -> str:
    """Compact one-cell representation of top-3 SHAP improvements."""
    return " | ".join(
        f"{s.direction}{s.feature}:+€{s.delta_eur/1e6:.2f}M" for s in top3
    )


def predict_test_set(model, features, medians, joined: pd.DataFrame, train_stds: pd.Series) -> pd.DataFrame:
    test_seasons = {"2021", "2022"}
    test_df = joined[joined["season"].astype(str).isin(test_seasons)].copy().reset_index(drop=True)
    test_df[features] = test_df[features].fillna(medians)

    X = test_df[features]
    preds = model.predict(X)

    out = pd.DataFrame({
        "season": test_df["season"].astype(str),
        "player_name": test_df["player_name"],
        "from_club": test_df["club_2"],
        "to_club": test_df["team_name"],
        "position": test_df.get("player_position", pd.Series([""] * len(test_df))),
        "age": test_df.get("player_age", pd.Series([np.nan] * len(test_df))),
        "actual_fee_eur": test_df["transfer_fee"].astype(float),
        "predicted_fee_eur": preds.astype(float),
    })
    out["residual_eur"] = out["actual_fee_eur"] - out["predicted_fee_eur"]
    out["abs_pct_error"] = (out["residual_eur"].abs() / out["actual_fee_eur"]).round(3)

    # SHAP top-3 per player. Slow-ish (k * n_features predictions per row) but n=96 is fine.
    log.info("Computing SHAP top-3 for %d test rows...", len(test_df))
    top3_strs = []
    for _, row in test_df.iterrows():
        top3 = top_k_stat_improvements(model, row, features, train_stds, k=3)
        top3_strs.append(_format_top3(top3))
    out["top3_stat_improvements"] = top3_strs

    return out.sort_values("actual_fee_eur", ascending=False).reset_index(drop=True)


def make_fake_player(features: list[str], medians: pd.Series) -> dict:
    """Synthesize a 23-year-old high-output forward profile.

    Roughly: a Saka/Foden/Saint-Maximin shape — decent minutes, ~13 G+A,
    healthy xG and progressive contribution. All stat values are in the
    realistic range for a Big-5 starter season.
    """
    return {
        "name": "Fictional Forward, 23yo",
        "position": "Right Winger",
        "age": 23,
        "stats": {
            "MP_Playing": 32,
            "Starts_Playing": 28,
            "Min_Playing": 2520,
            "Mins_Per_90_Playing": 28.0,
            "Gls": 9,
            "Ast": 6,
            "G_minus_PK": 9,
            "PK": 0,
            "PKatt": 0,
            "CrdY": 4,
            "CrdR": 0,
            "Gls_Per": 0.32,
            "Ast_Per": 0.21,
            "G+A_Per": 0.54,
            "G_minus_PK_Per": 0.32,
            "G+A_minus_PK_Per": 0.54,
            "xG_Expected": 7.8,
            "npxG_Expected": 7.8,
            "xAG_Expected": 5.2,
            "npxG+xAG_Expected": 13.0,
            "xG_Per": 0.28,
            "xAG_Per": 0.19,
            "xG+xAG_Per": 0.47,
            "npxG_Per": 0.28,
            "npxG+xAG_Per": 0.47,
        },
    }


def predict_fake_player(model, features, medians, train_stds: pd.Series) -> pd.DataFrame:
    fake = make_fake_player(features, medians)
    row = pd.Series({**medians.to_dict(), **fake["stats"]})  # fill any missing with medians
    X = pd.DataFrame([row[features].values], columns=features)
    pred = float(model.predict(X)[0])
    top3 = top_k_stat_improvements(model, row, features, train_stds, k=3)

    df = pd.DataFrame([{
        "name": fake["name"],
        "position": fake["position"],
        "age": fake["age"],
        "predicted_fee_eur": pred,
        "predicted_fee_eur_human": f"€{pred/1e6:.1f}M",
        "top3_stat_improvements": _format_top3(top3),
    }])

    # Per-stat input dump as a separate flattened CSV for transparency.
    stats_df = pd.DataFrame([fake["stats"]])
    return df, stats_df


def main() -> int:
    model, features, medians = _load_artifacts()

    seasons = list(range(2014, 2023))
    transfers = load_transfers(seasons=seasons)
    stats = load_fbref_player_stats(seasons=seasons + [s + 1 for s in seasons])
    joined = join_transfers_with_prior_season_stats(transfers, stats, age_tolerance=2)

    train_seasons = {str(s) for s in range(2014, 2021)}
    train_df = joined[joined["season"].astype(str).isin(train_seasons)].copy()
    train_df[features] = train_df[features].fillna(medians)
    train_stds = train_df[features].std()

    log.info("Predicting on full held-out test set...")
    test_preds = predict_test_set(model, features, medians, joined, train_stds)
    out_path = PREDICTIONS_DIR / "test_set.csv"
    test_preds.to_csv(out_path, index=False)
    log.info("Wrote %s (%d rows)", out_path, len(test_preds))

    sample_path = PREDICTIONS_DIR / "sample_top.csv"
    test_preds.head(10).to_csv(sample_path, index=False)
    log.info("Wrote %s (top 10 by actual fee)", sample_path)

    log.info("Predicting on synthetic fake player...")
    fake_df, fake_stats_df = predict_fake_player(model, features, medians, train_stds)
    fake_path = PREDICTIONS_DIR / "fake_player.csv"
    fake_df.to_csv(fake_path, index=False)
    fake_stats_path = PREDICTIONS_DIR / "fake_player_input_stats.csv"
    fake_stats_df.to_csv(fake_stats_path, index=False)
    log.info("Wrote %s + %s", fake_path, fake_stats_path)

    print("\n" + "=" * 80)
    print("TOP 10 — held-out test set, actual vs predicted fee")
    print("=" * 80)
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 12)
    show = test_preds.head(10).copy()
    show["actual"] = (show["actual_fee_eur"] / 1e6).round(1).map(lambda x: f"€{x:>5.1f}M")
    show["predicted"] = (show["predicted_fee_eur"] / 1e6).round(1).map(lambda x: f"€{x:>5.1f}M")
    show["residual"] = (show["residual_eur"] / 1e6).round(1).map(lambda x: f"{x:+.1f}M")
    show["err%"] = (show["abs_pct_error"] * 100).round(0).astype(int).map(lambda x: f"{x}%")
    print(show[["season", "player_name", "to_club", "actual", "predicted", "residual", "err%", "top3_stat_improvements"]].to_string(index=False))

    print("\n" + "=" * 80)
    print("FAKE PLAYER PREDICTION")
    print("=" * 80)
    print(fake_df.to_string(index=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
