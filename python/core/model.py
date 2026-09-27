"""Training, temporal split, and metrics.

Locked decisions:
  - Temporal split by season (eng-review Issue 1C)
  - Player-disjoint enforcement: drop test-set players who appear in training
  - Drift-aware: report metrics separately for pre- and post-2022
  - xgboost primary; linear/quantile baseline as fallback if n < MIN_TRAIN_N
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import QuantileRegressor, Ridge
from sklearn.metrics import mean_absolute_error
from scipy.stats import spearmanr

from . import config


@dataclass
class SplitResult:
    train: pd.DataFrame
    test: pd.DataFrame
    dropped_for_leakage: int


def temporal_split(
    df: pd.DataFrame,
    season_col: str = "season",
    player_id_col: str = "player",
    train_seasons: list[str] | None = None,
    test_seasons: list[str] | None = None,
) -> SplitResult:
    """Split by transfer season; drop test-set players who also appear in training.

    Asserts no season overlap between train and test.
    Asserts no player appears in both halves after the disjoint pass.
    """
    train_seasons = train_seasons or config.TRAIN_SEASONS
    test_seasons = test_seasons or config.TEST_SEASONS

    overlap = set(train_seasons) & set(test_seasons)
    if overlap:
        raise ValueError(f"train and test seasons overlap: {overlap}")

    train = df[df[season_col].isin(train_seasons)].copy()
    test_raw = df[df[season_col].isin(test_seasons)].copy()

    train_players = set(train[player_id_col].unique())
    leakage_mask = test_raw[player_id_col].isin(train_players)
    dropped = int(leakage_mask.sum())
    test = test_raw[~leakage_mask].copy()

    if len(test) == 0:
        raise ValueError(
            "Empty test set after player-disjoint filter — every test-set player also appears in training."
        )

    # Final assertion: no player in both halves.
    assert set(train[player_id_col]).isdisjoint(set(test[player_id_col])), \
        "player-disjoint enforcement failed"

    return SplitResult(train=train, test=test, dropped_for_leakage=dropped)


def train_xgb(X: pd.DataFrame, y: pd.Series, random_state: int = config.RANDOM_SEED) -> xgb.XGBRegressor:
    """Standard xgboost regressor with conservative defaults."""
    model = xgb.XGBRegressor(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=random_state,
        n_jobs=-1,
    )
    model.fit(X, y)
    return model


def train_baseline_linear(X: pd.DataFrame, y: pd.Series, random_state: int = config.RANDOM_SEED) -> Ridge:
    """Ridge regression baseline. Used when n < MIN_TRAIN_N or as a comparison."""
    model = Ridge(alpha=1.0, random_state=random_state)
    model.fit(X, y)
    return model


def train_quantile_baseline(X: pd.DataFrame, y: pd.Series, quantile: float = 0.5) -> QuantileRegressor:
    """Quantile regression baseline (median by default)."""
    model = QuantileRegressor(quantile=quantile, alpha=0.0, solver="highs")
    model.fit(X, y)
    return model


@dataclass
class Metrics:
    mae_eur: float
    spearman: float
    n: int


def compute_metrics(y_true: pd.Series, y_pred: np.ndarray | pd.Series) -> Metrics:
    """MAE in € and Spearman rank correlation. Both verified on actual disclosed fees."""
    y_true = pd.Series(y_true).reset_index(drop=True)
    y_pred = pd.Series(y_pred).reset_index(drop=True)
    if len(y_true) == 0:
        raise ValueError("compute_metrics: empty y_true")
    mae = float(mean_absolute_error(y_true, y_pred))
    rho, _ = spearmanr(y_true, y_pred)
    return Metrics(mae_eur=mae, spearman=float(rho) if not np.isnan(rho) else 0.0, n=len(y_true))


def compute_drift_metrics(
    test_df: pd.DataFrame,
    y_pred: np.ndarray,
    season_col: str = "season",
    pre_post_split_season: str = "2022-2023",
    label_col: str = "transfer_fee",
) -> dict[str, Metrics]:
    """Metrics split into pre- and post-cut for drift awareness.

    Returns {"pre": Metrics, "post": Metrics, "all": Metrics}.
    """
    test_df = test_df.reset_index(drop=True).copy()
    y_pred_series = pd.Series(y_pred).reset_index(drop=True)

    if label_col not in test_df.columns:
        raise KeyError(f"label_col '{label_col}' not in test_df.columns: {list(test_df.columns)[:10]}...")

    seasons_sorted = sorted(test_df[season_col].astype(str).unique())
    cut_str = str(pre_post_split_season)
    cut_idx = seasons_sorted.index(cut_str) if cut_str in seasons_sorted else 0
    pre_seasons = set(seasons_sorted[:cut_idx])
    post_seasons = set(seasons_sorted[cut_idx:])

    pre_mask = test_df[season_col].astype(str).isin(pre_seasons)
    post_mask = test_df[season_col].astype(str).isin(post_seasons)

    out: dict[str, Metrics] = {}
    if pre_mask.any():
        out["pre"] = compute_metrics(test_df.loc[pre_mask, label_col], y_pred_series[pre_mask])
    if post_mask.any():
        out["post"] = compute_metrics(test_df.loc[post_mask, label_col], y_pred_series[post_mask])
    out["all"] = compute_metrics(test_df[label_col], y_pred_series)
    return out
