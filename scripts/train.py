"""Weekend 2: feature selection + train + evaluate.

Loads the joined transfer × prior-season-stats dataset, selects features
statistically (LASSO + RFE + MI), splits temporally with player-disjoint
enforcement, trains xgboost + linear baseline, reports metrics, persists
the trained model + feature list.
"""
from __future__ import annotations

import json
import logging
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("train")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src import config  # noqa: E402
from src.data import (  # noqa: E402
    join_transfers_with_prior_season_stats,
    load_fbref_player_stats,
    load_transfers,
)
from src.features import select_features  # noqa: E402
from src.model import (  # noqa: E402
    compute_drift_metrics,
    compute_metrics,
    temporal_split,
    train_baseline_linear,
    train_xgb,
)


# Columns that are NOT predictive features (target, IDs, free text, age dupes).
EXCLUDE_FROM_FEATURES = {
    "transfer_fee",  # the label
    "is_loan",  # always False after filter
    "in_squad",  # post-transfer column (label leakage from future)
    "appearances",  # post-transfer
    "goals",  # post-transfer (in transfer table; FBref Gls is fine)
    "minutes_played",  # post-transfer
    "Born",  # raw date int, not directly useful
    "_prior_season_end",
    "_age",
    "_age_stats",
    "Season_End_Year",
    "_join_season_end",
}


def prepare_dataset() -> pd.DataFrame:
    """Load + filter + join all data. Mirrors sanity_check but returns the frame."""
    seasons = list(range(2014, 2023))
    log.info("Loading transfers + FBref stats for seasons %d-%d", seasons[0], seasons[-1])
    transfers = load_transfers(seasons=seasons)
    stats = load_fbref_player_stats(seasons=seasons + [s + 1 for s in seasons])
    joined = join_transfers_with_prior_season_stats(transfers, stats, age_tolerance=2)
    log.info("Joined dataset: %d rows × %d cols", *joined.shape)
    return joined


def split_train_test(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """Temporal split: 2014-2020 train, 2021-2022 test. Player-disjoint enforced."""
    df = df.copy()
    df["season"] = df["season"].astype(str)
    train_seasons = [str(s) for s in range(2014, 2021)]
    test_seasons = ["2021", "2022"]
    res = temporal_split(
        df,
        season_col="season",
        player_id_col="player_name",
        train_seasons=train_seasons,
        test_seasons=test_seasons,
    )
    log.info("Split: train=%d, test=%d, dropped_for_leakage=%d",
             len(res.train), len(res.test), res.dropped_for_leakage)
    return res.train, res.test, res.dropped_for_leakage


def numeric_features(df: pd.DataFrame) -> list[str]:
    """Return the numeric columns we actually want to feed into the model."""
    feats = []
    for col, dt in df.dtypes.items():
        if not pd.api.types.is_numeric_dtype(dt):
            continue
        if col in EXCLUDE_FROM_FEATURES:
            continue
        feats.append(col)
    return feats


def main() -> int:
    joined = prepare_dataset()
    train_df, test_df, dropped = split_train_test(joined)

    feature_cols = numeric_features(train_df)
    log.info("Numeric feature candidates (%d): %s", len(feature_cols), feature_cols)

    X_train_full = train_df[feature_cols].copy()
    y_train = train_df["transfer_fee"].copy()
    X_test_full = test_df[feature_cols].copy()
    y_test = test_df["transfer_fee"].copy()

    # Fill numeric NaNs with column medians from training (avoid test leakage).
    medians = X_train_full.median(numeric_only=True)
    X_train_full = X_train_full.fillna(medians)
    X_test_full = X_test_full.fillna(medians)

    log.info("Running feature selection (LASSO + RFE + MI)...")
    selected = select_features(X_train_full, y_train, n_features=15)
    log.info("Selected (%d): %s", len(selected), selected)

    X_train = X_train_full[selected]
    X_test = X_test_full[selected]

    log.info("Training xgboost...")
    xgb_model = train_xgb(X_train, y_train)
    xgb_pred = xgb_model.predict(X_test)

    log.info("Training linear (Ridge) baseline...")
    lin_model = train_baseline_linear(X_train, y_train)
    lin_pred = lin_model.predict(X_test)

    xgb_metrics = compute_metrics(y_test, xgb_pred)
    lin_metrics = compute_metrics(y_test, lin_pred)

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"  Train n: {len(X_train)}, Test n: {len(X_test)} (dropped {dropped} for player leakage)")
    print(f"  Selected features ({len(selected)}): {selected}")
    print()
    print(f"  XGBoost     | MAE €{xgb_metrics.mae_eur/1e6:.2f}M | Spearman ρ {xgb_metrics.spearman:.3f}")
    print(f"  Linear/Ridge| MAE €{lin_metrics.mae_eur/1e6:.2f}M | Spearman ρ {lin_metrics.spearman:.3f}")

    # Drift split: pre/post 2022. Test set has 2021 + 2022 only, so split inside it.
    drift = compute_drift_metrics(test_df.copy(), xgb_pred, season_col="season",
                                  pre_post_split_season="2022", label_col="transfer_fee")
    if "pre" in drift:
        print(f"  XGB 2021    (n={drift['pre'].n}) | MAE €{drift['pre'].mae_eur/1e6:.2f}M | ρ {drift['pre'].spearman:.3f}")
    if "post" in drift:
        print(f"  XGB 2022    (n={drift['post'].n}) | MAE €{drift['post'].mae_eur/1e6:.2f}M | ρ {drift['post'].spearman:.3f}")

    # Persist for SHAP step.
    import pickle
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = config.MODELS_DIR / "xgb_transfer_fee.pkl"
    feats_path = config.MODELS_DIR / "selected_features.json"
    with open(model_path, "wb") as f:
        pickle.dump(xgb_model, f)
    with open(feats_path, "w") as f:
        json.dump({
            "features": selected,
            "medians": {k: float(v) for k, v in medians.items() if k in selected},
            "xgb_metrics": asdict(xgb_metrics),
            "lin_metrics": asdict(lin_metrics),
        }, f, indent=2)
    log.info("Saved %s", model_path)
    log.info("Saved %s", feats_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
