"""Feature engineering for the transfer-fee model.

Locked decisions:
  - Statistical feature selection (LASSO + RFE + mutual information ensemble), eng-review Issue 1D.
  - Per-90 normalization for counting stats.
  - Goalkeepers excluded.
  - Position groups: forwards / midfielders / defenders.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.feature_selection import RFE, mutual_info_regression
from sklearn.linear_model import LassoCV
from sklearn.preprocessing import StandardScaler

from . import config


POSITION_GROUPS = {
    "FW": "forward",
    "ST": "forward",
    "CF": "forward",
    "LW": "forward",
    "RW": "forward",
    "MF": "midfielder",
    "CM": "midfielder",
    "AM": "midfielder",
    "DM": "midfielder",
    "DF": "defender",
    "CB": "defender",
    "LB": "defender",
    "RB": "defender",
    "WB": "defender",
    "GK": "goalkeeper",  # excluded downstream
}


def assign_position_group(pos: str) -> str:
    """Map FBref position string to one of {forward, midfielder, defender, goalkeeper, unknown}.

    FBref's 'pos' column is comma-separated like 'FW,MF'. Take the primary (first) token.
    """
    if not isinstance(pos, str) or not pos:
        return "unknown"
    primary = pos.split(",")[0].strip().upper()
    return POSITION_GROUPS.get(primary, "unknown")


def compute_per90(value: float | int, minutes: float | int) -> float:
    """Per-90 normalization. Returns NaN if minutes <= 0 (caught upstream).

    Used for counting stats only. Rate stats (e.g., pass completion %) bypass this.
    """
    if minutes is None or pd.isna(minutes) or minutes <= 0:
        return float("nan")
    return float(value) / (float(minutes) / 90.0)


def select_features(
    X: pd.DataFrame,
    y: pd.Series,
    n_features: int = 15,
    random_state: int = config.RANDOM_SEED,
) -> list[str]:
    """Ensemble feature selection: LASSO + RFE + mutual information.

    Each method votes for its top-N features; the union of vote winners (capped at
    n_features per method) is returned. Empty input raises.
    """
    if X.empty or len(X.columns) == 0:
        raise ValueError("select_features requires a non-empty X with at least one column")
    if len(X) != len(y):
        raise ValueError(f"X and y row count mismatch: {len(X)} vs {len(y)}")

    numeric_X = X.select_dtypes(include=[np.number]).copy()
    if numeric_X.empty:
        raise ValueError("select_features requires at least one numeric column in X")

    numeric_X = numeric_X.fillna(numeric_X.median(numeric_only=True))

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(numeric_X)
    cols = list(numeric_X.columns)

    # 1. LASSO: nonzero coefficients are the selected features.
    lasso = LassoCV(cv=5, random_state=random_state, max_iter=10000).fit(X_scaled, y)
    lasso_winners = [
        c for c, coef in zip(cols, lasso.coef_) if abs(coef) > 1e-8
    ][:n_features]

    # 2. Mutual information: top-N by score.
    mi_scores = mutual_info_regression(X_scaled, y, random_state=random_state)
    mi_winners = [c for c, _ in sorted(zip(cols, mi_scores), key=lambda kv: -kv[1])[:n_features]]

    # 3. RFE on a small linear estimator. Use Lasso again for stability.
    from sklearn.linear_model import Lasso

    rfe = RFE(estimator=Lasso(alpha=0.01, random_state=random_state, max_iter=10000), n_features_to_select=n_features)
    rfe.fit(X_scaled, y)
    rfe_winners = [c for c, keep in zip(cols, rfe.support_) if keep]

    union = list(dict.fromkeys(lasso_winners + mi_winners + rfe_winners))
    return union[: max(n_features, 5)]
