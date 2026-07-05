"""Salary / value estimator (v2, user step 3) — value-based, not real-salary-trained.

Real per-player KBO salaries are not published as a dataset (the stats sites don't
carry them and statiz is off-limits), so this is a transparent VALUE model: it maps a
player's WAR to a won figure via a convex WAR→₩ curve, anchored to public KBO reference
points (league minimum ≈ ₩30M; elite ≈ ₩1.5B). An optional age tilt nudges toward the
FA-age premium when age is available (it isn't in the open backtest dump). Clearly an
*estimate of value*, not a claim of actual salary.

Team payroll (the sum of these estimates over a roster, weighted by playing time) is the
"investment" signal the winning-environment factor uses in team_build.py.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MIN_SALARY_WON = 30_000_000        # KBO league minimum (~₩30M)
_WAR_SCALE_WON = 110_000_000       # ₩ per WAR^exponent above replacement
_WAR_EXP = 1.25                    # mild convexity: stars paid super-linearly
MAX_SALARY_WON = 2_500_000_000     # cap (annualized megadeal ceiling)


def _age_factor(age):
    """Mild multiplier peaking around the FA/prime age band (~29-32); 1.0 if unknown."""
    if age is None or (isinstance(age, float) and np.isnan(age)):
        return 1.0
    # bell centered at 30, ±0.15 across the plausible range
    return float(np.clip(1.0 + 0.15 * np.exp(-((age - 30.0) ** 2) / (2 * 4.0 ** 2)) - 0.05, 0.85, 1.20))


def est_salary_won(war, age=None) -> float:
    """Estimated value in won from WAR (+ optional age tilt)."""
    war = max(0.0, float(war))
    val = MIN_SALARY_WON + (war ** _WAR_EXP) * _WAR_SCALE_WON
    return float(np.clip(val * _age_factor(age), MIN_SALARY_WON, MAX_SALARY_WON))


def add_salary(values: pd.DataFrame, war_col: str = "WAR", age_col: str = "age") -> pd.DataFrame:
    """Add an `est_salary_won` column to a player-value frame (uses age if present)."""
    out = values.copy()
    ages = out[age_col] if age_col in out.columns else pd.Series([None] * len(out), index=out.index)
    out["est_salary_won"] = [est_salary_won(w, a) for w, a in zip(out[war_col], ages)]
    out["est_salary_ok"] = (out["est_salary_won"] / 1e8).round(2)   # in 억원 for display
    return out


if __name__ == "__main__":
    for w in [0, 0.5, 1, 2, 3, 5, 7, 9]:
        print(f"WAR {w}: est ₩{est_salary_won(w)/1e8:.2f}억")
