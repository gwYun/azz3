"""Weekend 2 (enriched): feature engineering + train + evaluate.

Loads the joined transfer × prior-season-stats dataset, enriches with player
market value, contract & tenure, position group, age curve, multi-season
trajectory, transfer-table categoricals; deflates the target by per-season
median fee; trains xgboost + linear baseline; reports nominal-EUR metrics;
persists model + feature list + encoders + deflator.
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
    attach_prior_player_vals,
    join_transfers_with_prior_season_stats,
    load_fbref_all_stats,
    load_fbref_player_stats,
    load_player_vals_for_join,
    load_transfers,
)
from src.enrich import (  # noqa: E402
    FeeDeflator,
    FrequencyEncoders,
    NUMERIC_EXTRAS,
    attach_trajectory,
    build_trajectory_features,
    enrich,
)
from src.features import select_features  # noqa: E402
from src.model import (  # noqa: E402
    compute_drift_metrics,
    compute_metrics,
    temporal_split,
    train_baseline_linear,
    train_xgb,
)


# Columns that are NOT predictive features (target, IDs, free text, leakage).
# Note: `season` (raw string) is NOT listed here but is naturally excluded
# because numeric_features() only picks numeric dtype columns. `season_numeric`
# (the numeric version derived in enrich()) IS used as a feature via must_include.
EXCLUDE_FROM_FEATURES = {
    "transfer_fee",            # label
    "is_loan",                 # always False after filter
    "in_squad",                # post-transfer leakage
    "appearances",             # post-transfer
    "goals",                   # post-transfer
    "minutes_played",          # post-transfer
    "Born",                    # raw date int
    "_prior_season_end",
    "_age",
    "_age_stats",
    "_name_norm",
    "Season_End_Year",
    "_join_season_end",
    # FBref columns now reflected in derived features (keep one set, avoid the dupe).
    "Age",                     # replaced by age_years (numeric)
}

# Categoricals we frequency-encode on training data.
FREQ_ENCODE_COLS = ["club_2", "team_name", "player_nationality"]


def prepare_dataset() -> pd.DataFrame:
    """Load + filter + enrich the full joined frame."""
    seasons = list(range(2014, 2026))

    log.info("Loading transfers for transfer seasons %d-%d", seasons[0], seasons[-1])
    transfers = load_transfers(seasons=seasons)

    # Stats needed: prior season of each transfer (transfer-season "S" → Season_End_Year=S),
    # plus older years for the 3-season trajectory lookback.
    stat_years = list(range(min(seasons) - 4, max(seasons) + 2))
    log.info("Loading all FBref tables for Season_End_Year %d-%d", stat_years[0], stat_years[-1])
    stats_all = load_fbref_all_stats(seasons=stat_years)
    stats_std_for_trajectory = load_fbref_player_stats(seasons=stat_years)

    log.info("Joining transfers ↔ prior-season FBref...")
    joined = join_transfers_with_prior_season_stats(transfers, stats_all, age_tolerance=2)
    log.info("Joined: %d rows × %d cols", *joined.shape)

    log.info("Attaching trajectory (3-season rolling/slope) features...")
    traj = build_trajectory_features(stats_std_for_trajectory)
    joined = attach_trajectory(joined, traj)

    log.info("Attaching prior-season TM market value + contract/tenure...")
    vals = load_player_vals_for_join(seasons=stat_years)
    joined = attach_prior_player_vals(joined, vals)

    log.info("Enriching (position, age, categoricals, foot)...")
    joined = enrich(joined)

    log.info("Final enriched: %d rows × %d cols", *joined.shape)
    return joined


def split_train_test(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """Temporal split: 2014-2022 train, 2023-2025 test. Player-disjoint enforced."""
    df = df.copy()
    df["season"] = df["season"].astype(str)
    train_seasons = [str(s) for s in range(2014, 2023)]
    test_seasons = ["2023", "2024", "2025"]
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


def numeric_features(df: pd.DataFrame, extras: list[str]) -> list[str]:
    """Numeric feature candidates: all numeric cols minus excludes, plus any extras
    that are present (even if dtype isn't pure numeric in some rows).
    """
    feats = []
    for col, dt in df.dtypes.items():
        if col in EXCLUDE_FROM_FEATURES:
            continue
        if pd.api.types.is_numeric_dtype(dt):
            feats.append(col)
    # Ensure extras are present and not double-counted.
    for c in extras:
        if c in df.columns and c not in feats and c not in EXCLUDE_FROM_FEATURES:
            feats.append(c)
    return feats


def _sanitize_columns(cols: list[str]) -> list[str]:
    """xgboost rejects feature names containing '[', ']', '<'. Map them out."""
    out = []
    for c in cols:
        s = c.replace("[", "_").replace("]", "_").replace("<", "_lt_")
        out.append(s)
    return out


def main() -> int:
    joined = prepare_dataset()
    train_df, test_df, dropped = split_train_test(joined)

    # Fit frequency encoders on train, transform both halves.
    freq = FrequencyEncoders().fit(train_df, FREQ_ENCODE_COLS)
    train_df = freq.transform(train_df)
    test_df = freq.transform(test_df)
    freq_added = [f"{c}_freq" for c in FREQ_ENCODE_COLS]

    feature_candidates = numeric_features(train_df, extras=NUMERIC_EXTRAS + freq_added)
    log.info("Candidate features: %d", len(feature_candidates))

    X_train_full = train_df[feature_candidates].copy()
    y_train = train_df["transfer_fee"].copy()
    X_test_full = test_df[feature_candidates].copy()
    y_test = test_df["transfer_fee"].copy()

    medians = X_train_full.median(numeric_only=True)
    # Drop candidates that are entirely NaN on training (median undefined).
    fully_nan = [c for c in X_train_full.columns if pd.isna(medians.get(c, np.nan))]
    if fully_nan:
        log.info("Dropping %d all-NaN training candidates: %s", len(fully_nan), fully_nan[:8])
        X_train_full = X_train_full.drop(columns=fully_nan)
        X_test_full = X_test_full.drop(columns=fully_nan)
        medians = medians.drop(labels=fully_nan, errors="ignore")
    X_train_full = X_train_full.fillna(medians).fillna(0.0)
    X_test_full = X_test_full.fillna(medians).fillna(0.0)

    # Fit deflator on TRAIN ONLY, then extrapolate to TEST seasons.
    deflator = FeeDeflator(baseline_season="2014").fit(train_df)
    deflator.extrapolate(test_df["season"].astype(str).unique())
    log.info("Deflator (factor per season, 2014=1.0): %s",
             {k: round(v, 3) for k, v in sorted(deflator.deflator.items())})

    y_train_deflated = deflator.deflate(y_train, train_df["season"])

    # Selection runs on log(deflated) for numerical stability (LASSO scales).
    y_for_selection = np.log1p(y_train_deflated.clip(lower=1.0))

    log.info("Running feature selection (LASSO + RFE + MI) on log-deflated target...")
    selected = select_features(X_train_full, y_for_selection, n_features=15)

    # Domain-prior must-includes: features that should always reach the model
    # if the column exists and has any signal. Avoids selection-method dropouts
    # for the strongest predictors.
    must_include = [
        "prior_market_value_eur",
        "age_years", "peak_distance",
        "contract_years_remaining", "tenure_at_selling_club_years",
        "pos_forward", "pos_midfielder", "pos_defender",
        "season_numeric",
        "league_premier_league", "league_serie_a", "league_ligue_1", "league_laliga", "league_bundesliga",
    ]
    for c in must_include:
        if c in X_train_full.columns and c not in selected:
            selected.append(c)
    log.info("Selected after must-include (%d): %s", len(selected), selected)

    X_train = X_train_full[selected].copy()
    X_test = X_test_full[selected].copy()

    # Sanitize feature names for xgboost.
    sanitized = _sanitize_columns(list(X_train.columns))
    rename_map = dict(zip(X_train.columns, sanitized))
    X_train = X_train.rename(columns=rename_map)
    X_test = X_test.rename(columns=rename_map)

    # Train on log(deflated) — handles the heavy-tailed fee distribution
    # without letting €100M outliers dominate residuals. Inverse:
    #   nominal_pred = expm1(model.predict) * deflator[season]
    y_train_log = np.log1p(y_train_deflated.clip(lower=1.0))

    log.info("Training xgboost on log-deflated target...")
    xgb_model = train_xgb(X_train, y_train_log)
    xgb_pred = (np.expm1(xgb_model.predict(X_test)) *
                test_df["season"].astype(str).map(deflator.deflator).to_numpy())

    log.info("Training Ridge baseline on log-deflated target...")
    lin_model = train_baseline_linear(X_train, y_train_log)
    lin_pred = (np.expm1(lin_model.predict(X_test)) *
                test_df["season"].astype(str).map(deflator.deflator).to_numpy())

    xgb_metrics = compute_metrics(y_test, xgb_pred)
    lin_metrics = compute_metrics(y_test, lin_pred)

    print("\n" + "=" * 60)
    print("RESULTS (nominal € after re-inflation)")
    print("=" * 60)
    print(f"  Train n: {len(X_train)}, Test n: {len(X_test)} (dropped {dropped} for player leakage)")
    print(f"  Selected features ({len(selected)}): {selected}")
    print()
    print(f"  XGBoost     | MAE €{xgb_metrics.mae_eur/1e6:.2f}M | Spearman ρ {xgb_metrics.spearman:.3f}")
    print(f"  Linear/Ridge| MAE €{lin_metrics.mae_eur/1e6:.2f}M | Spearman ρ {lin_metrics.spearman:.3f}")

    drift = compute_drift_metrics(test_df.copy(), xgb_pred, season_col="season",
                                  pre_post_split_season="2022", label_col="transfer_fee")
    if "pre" in drift:
        print(f"  XGB 2021    (n={drift['pre'].n}) | MAE €{drift['pre'].mae_eur/1e6:.2f}M | ρ {drift['pre'].spearman:.3f}")
    if "post" in drift:
        print(f"  XGB 2022    (n={drift['post'].n}) | MAE €{drift['post'].mae_eur/1e6:.2f}M | ρ {drift['post'].spearman:.3f}")

    # Persist.
    import pickle
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = config.MODELS_DIR / "xgb_transfer_fee.pkl"
    feats_path = config.MODELS_DIR / "selected_features.json"
    with open(model_path, "wb") as f:
        pickle.dump(xgb_model, f)
    with open(feats_path, "w") as f:
        train_stds = X_train.std()
        json.dump({
            "features": list(X_train.columns),
            "rename_map": rename_map,                   # original_name -> xgb-safe name
            "medians": {k: float(v) for k, v in medians.items() if rename_map.get(k, k) in X_train.columns},
            "stds": {k: float(v) for k, v in train_stds.items() if not pd.isna(v)},
            "freq_encoders": freq.to_dict(),
            "deflator": deflator.to_dict(),
            "target_transform": "log1p_deflated",       # nominal = expm1(pred) * deflator[season]
            "xgb_metrics": asdict(xgb_metrics),
            "lin_metrics": asdict(lin_metrics),
        }, f, indent=2)
    log.info("Saved %s", model_path)
    log.info("Saved %s", feats_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
