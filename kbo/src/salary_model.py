"""Salary estimator (v2) — a WAR→₩ curve, LEVEL-calibrated to real KBO salaries.

Maps a player's WAR to a won figure via a convex WAR→₩ curve. We do NOT scrape statiz
(robots-blocked), but a static reference of real salaries (public Statiz historical top
earners + KBO official 2026 — see data.load_salary_reference) IS available, and the curve's
overall ₩/WAR SCALE is calibrated so its median matches those real top-earner salaries
(median ≈ ₩17억). The league-minimum floor and an optional FA-age tilt are unchanged.

IMPORTANT — only the LEVEL (overall scale) is calibrated, NOT the slope. That reference is a
censored top-earner sample (salary ≥ ₩13.65억) in which WAR and salary are ~uncorrelated
(corr ≈ 0), so it fixes the magnitude but carries no usable per-player WAR→salary slope.
Fitting the slope/convexity to it would flatten the curve to a ~₩17억 constant. The estimate
is therefore realistic in SCALE but NOT a per-player salary prediction — real salary is
shown alongside it and the per-player scatter is large (`evaluate_against_reference`).

Display-only: the simulation's winning-environment factor reads team WAR, not salary
(team_build.py). Team payroll (Σ of these estimates) is shown as an investment indicator
only and does not feed the ratings.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# NOTE: hand-mirrored in web/lib/kbo-salary.ts — change both in the same commit.
# Only the LEVEL (_WAR_SCALE_WON) is calibrated to the real-salary median. Do NOT fit the
# SLOPE (_WAR_EXP / the WAR-dependence) to the reference: it's a censored top-earner sample
# where WAR↔salary corr≈0, so the slope is not identified (see docstring + tests).
MIN_SALARY_WON = 30_000_000        # KBO league minimum (~₩30M) — floor, unscaled
_WAR_SCALE_WON = 310_000_000       # ₩ per WAR^exp; scaled so the curve's median matches
                                   # real top-earner salaries (₩17억 median over the ref)
_WAR_EXP = 1.25                    # convexity — fixed shape, NOT fit to the reference
MAX_SALARY_WON = 8_000_000_000     # ceiling ≈ largest real KBO salary (₩81억, 김광현 2022);
                                   # display-only (sim uses WAR), effectively never binds


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


def evaluate_against_reference(ref: pd.DataFrame | None = None) -> dict:
    """Diagnostics of the level-calibrated curve vs. real top-earner salaries.

    Filters the reference to realized, disclosed Statiz rows with WAR > 0, then compares
    `est_salary_won(war)` to the actual salary. Expected results after level-calibration:
    `median_real_over_est ≈ 1` (the SCALE is matched to the real median) but
    `corr_war_salary ≈ 0` and `r2_level < 0` — the reference is censored (salary ≥
    ₩13.65억), so WAR carries no usable per-player slope. In other words the magnitude is
    right while individual salaries are not predictable from WAR; this is surfaced in the
    report and asserted in tests so a future slope-refit (which would collapse the curve)
    is caught.
    """
    if ref is None:
        from . import data
        ref = data.load_salary_reference()
    war = pd.to_numeric(ref["war"], errors="coerce")
    mask = (ref["source"] == "statiz") & ref["war_realized"].astype(bool) \
        & ref["is_disclosed"].astype(bool) & (war > 0)
    war = war[mask].to_numpy(dtype=float)
    real = pd.to_numeric(ref["salary_won"][mask], errors="coerce").to_numpy(dtype=float)
    n = len(war)
    if n == 0:
        return {"n": 0}
    est = np.array([est_salary_won(w) for w in war])

    def _r2(y, yhat):
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        return 1.0 - float(np.sum((y - yhat) ** 2)) / ss_tot if ss_tot > 0 else float("nan")

    return {
        "n": n,
        "r2_level": round(_r2(real, est), 3),                       # negative: mean beats the curve
        "r2_log": round(_r2(np.log(real), np.log(est)), 3),
        "log_bias": round(float(np.mean(np.log(real) - np.log(est))), 3),
        "median_real_over_est": round(float(np.median(real / est)), 2),
        "corr_war_salary": round(float(np.corrcoef(war, real)[0, 1]), 3),
        "ceiling_p90_ok": round(float(np.percentile(real, 90) / 1e8), 1),
    }


if __name__ == "__main__":
    for w in [0, 0.5, 1, 2, 3, 5, 7, 9]:
        print(f"WAR {w}: est ₩{est_salary_won(w)/1e8:.2f}억")
    print("diagnostics:", evaluate_against_reference())
