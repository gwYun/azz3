"""Tests for temporal split correctness and metrics correctness.

The two assertions that matter most:
  - No player appears in both halves after the disjoint pass (locked Issue 1C).
  - MAE is reported in € (not log-€, not normalized).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.model import compute_metrics, temporal_split


def _make_df(rows):
    return pd.DataFrame(rows)


def test_temporal_split_no_player_leakage():
    """A player who transferred in both train and test windows must be dropped from test."""
    df = _make_df(
        [
            # Player A: in train only
            {"player": "alpha", "season": "2019-2020", "fee": 10_000_000},
            # Player B: in train AND test — must be dropped from test
            {"player": "bravo", "season": "2020-2021", "fee": 15_000_000},
            {"player": "bravo", "season": "2023-2024", "fee": 25_000_000},
            # Player C: test only
            {"player": "charlie", "season": "2023-2024", "fee": 8_000_000},
        ]
    )
    res = temporal_split(df)
    train_players = set(res.train["player"].unique())
    test_players = set(res.test["player"].unique())

    assert train_players.isdisjoint(test_players), "player-disjoint enforcement failed"
    assert "bravo" in train_players, "bravo's training row should remain"
    assert "bravo" not in test_players, "bravo's test row should be dropped (leakage)"
    assert res.dropped_for_leakage == 1


def test_temporal_split_no_date_overlap():
    """Train seasons and test seasons must not intersect."""
    df = _make_df(
        [
            {"player": "a", "season": "2019-2020", "fee": 1},
            {"player": "b", "season": "2023-2024", "fee": 1},
        ]
    )
    res = temporal_split(df)
    train_seasons = set(res.train["season"].unique())
    test_seasons = set(res.test["season"].unique())
    assert train_seasons.isdisjoint(test_seasons)


def test_temporal_split_overlap_raises():
    """Asking for overlapping train/test seasons must fail loudly."""
    df = _make_df([{"player": "x", "season": "2019-2020", "fee": 1}])
    with pytest.raises(ValueError, match="overlap"):
        temporal_split(df, train_seasons=["2019-2020"], test_seasons=["2019-2020"])


def test_temporal_split_empty_test_raises():
    """If every test player overlaps with training, test goes empty and we fail loudly."""
    df = _make_df(
        [
            {"player": "a", "season": "2019-2020", "fee": 1},
            {"player": "a", "season": "2023-2024", "fee": 1},
        ]
    )
    with pytest.raises(ValueError, match="Empty test set"):
        temporal_split(df)


def test_compute_mae_in_euros():
    """MAE must be on the original € scale, not log-€ or normalized."""
    y_true = pd.Series([10_000_000.0, 20_000_000.0, 30_000_000.0])
    y_pred = np.array([12_000_000.0, 18_000_000.0, 33_000_000.0])
    metrics = compute_metrics(y_true, y_pred)
    # MAE = mean(|2M, 2M, 3M|) = 7M / 3 ≈ 2_333_333
    assert 2_300_000 < metrics.mae_eur < 2_400_000, f"MAE in € expected ~2.33M, got {metrics.mae_eur}"
    # Spearman should be perfect rank match (1, 2, 3) -> (1, 2, 3)
    assert metrics.spearman > 0.99
    assert metrics.n == 3


def test_compute_metrics_empty_raises():
    with pytest.raises(ValueError, match="empty"):
        compute_metrics(pd.Series([], dtype=float), np.array([]))
