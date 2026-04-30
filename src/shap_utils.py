"""SHAP-based "which stat to improve" counterfactual.

Locked decisions:
  - shap.TreeExplainer (exact, fast for tree models). NOT KernelExplainer.
  - For a chosen player, perturb each feature by ±1 SD and pick top-3 by |Δfee|.
  - Output labeled "historical association, not causal advice".
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import shap


@dataclass
class StatImprovement:
    feature: str
    direction: str  # "+" or "-" (improve = which sign moves fee up)
    delta_eur: float  # predicted-fee change for ±1 SD perturbation


def compute_shap_values(model, X: pd.DataFrame) -> np.ndarray:
    """SHAP values via TreeExplainer. Returns array of shape (n_rows, n_features)."""
    explainer = shap.TreeExplainer(model)
    sv = explainer.shap_values(X)
    return np.asarray(sv)


def top_k_stat_improvements(
    model,
    player_row: pd.Series,
    feature_columns: list[str],
    feature_stds: pd.Series,
    k: int = 3,
) -> list[StatImprovement]:
    """For a single player, return top-k features whose ±1 SD perturbation
    moves the predicted fee up the most.

    Reports the SIGNED delta — improvement direction is the sign that raises fee.
    """
    base_X = pd.DataFrame([player_row[feature_columns].values], columns=feature_columns)
    base_pred = float(model.predict(base_X)[0])

    improvements: list[StatImprovement] = []
    for feat in feature_columns:
        std = float(feature_stds.get(feat, 0.0))
        if std == 0 or np.isnan(std):
            continue
        # Try both directions; keep the one that raises fee.
        up = base_X.copy()
        up[feat] = up[feat] + std
        down = base_X.copy()
        down[feat] = down[feat] - std
        delta_up = float(model.predict(up)[0]) - base_pred
        delta_down = float(model.predict(down)[0]) - base_pred
        if delta_up >= delta_down:
            improvements.append(StatImprovement(feat, "+", delta_up))
        else:
            improvements.append(StatImprovement(feat, "-", delta_down))

    improvements.sort(key=lambda s: -s.delta_eur)
    return improvements[:k]


def validate_rubric(
    model,
    player_row: pd.Series,
    feature_columns: list[str],
    feature_stds: pd.Series,
    expected_features_for_position: set[str],
    n_perturbation_steps: int = 5,
) -> dict[str, bool]:
    """Encode the success-criteria rubric (a)/(b)/(c) as a dict of pass/fail.

    a) top-3 stats are position-appropriate
    b) predicted-fee response is monotonic across realistic ±1 SD perturbation
    c) top stats are not just the top-3 by feature variance in training set
    """
    top3 = top_k_stat_improvements(model, player_row, feature_columns, feature_stds, k=3)
    top3_features = {s.feature for s in top3}

    # (a) position-appropriate: at least 1 of top-3 in expected set
    a_pass = bool(top3_features & expected_features_for_position)

    # (b) monotonicity: response across [-1, -0.5, 0, +0.5, +1] SD is monotonic
    base_X = pd.DataFrame([player_row[feature_columns].values], columns=feature_columns)
    base_pred = float(model.predict(base_X)[0])
    b_pass = True
    for feat in top3_features:
        std = float(feature_stds.get(feat, 0.0))
        if std == 0 or np.isnan(std):
            continue
        steps = np.linspace(-1.0, 1.0, n_perturbation_steps)
        preds = []
        for s in steps:
            X = base_X.copy()
            X[feat] = X[feat] + s * std
            preds.append(float(model.predict(X)[0]))
        diffs = np.diff(preds)
        if not (np.all(diffs >= -1e-6) or np.all(diffs <= 1e-6)):
            b_pass = False
            break

    # (c) not-just-high-variance: top stats are not exactly the top-3 by std
    top_var_features = set(feature_stds.sort_values(ascending=False).head(3).index)
    c_pass = top3_features != top_var_features

    return {"position_appropriate": a_pass, "monotonic": b_pass, "not_just_variance": c_pass}
