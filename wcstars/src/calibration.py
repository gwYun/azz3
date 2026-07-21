"""Calibrate the multiplier LEVEL to the James-2014 anchor; VALIDATE out-of-sample.

Discipline (mirrors kbo/src/salary_model.py::evaluate_against_reference):
  - Calibrate ONE scalar, K, so the primary anchor (James Rodriguez 2014) reproduces
    his real ~1.67x market-value jump. Nothing else is fit.
  - The 2026 movers (Bouaddi, Manzambi, Kone) are held OUT of calibration and only
    checked afterward. We report predicted-vs-real and never tune K to hit them
    (that would be the slope-fitting the salary model warns against).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve()
if str(_HERE.parents[2]) not in sys.path:
    sys.path.insert(0, str(_HERE.parents[2]))

from wcstars.src import breakout as bo  # noqa: E402

_DATA = _HERE.parents[1] / "data"

# James Rodriguez's 2014 spotlight inputs, from historical_breakouts.json primary
# anchor. E=0.65 (Colombia reached the quarterfinals), P=0.92 (Golden Boot / clear
# standout attacker), age 22, pre-transfer MV €45M. These pin the target profile.
JAMES = {"E": 0.65, "P": 0.92, "age": 22.0, "v0_eur": 45_000_000.0, "target_mult": 1.67}


def calibrated_k(target: float = JAMES["target_mult"]) -> float:
    """Solve K so the James profile hits `target` (M-1 is linear in K)."""
    unit = (bo.spotlight(JAMES["E"], JAMES["P"])
            * bo.youth_factor(JAMES["age"])
            * bo.ceiling_factor(JAMES["v0_eur"]))
    return float((target - 1.0) / unit) if unit > 0 else bo.K


def james_check(k: float = bo.K) -> dict:
    m = bo.multiplier(JAMES["E"], JAMES["P"], JAMES["age"], JAMES["v0_eur"], k=k)
    return {"anchor": "James Rodriguez 2014", "target_mult": JAMES["target_mult"],
            "model_mult": round(m, 3), "K_used": k, "K_exact": round(calibrated_k(), 3),
            "abs_err": round(abs(m - JAMES["target_mult"]), 3)}


def _find_row(board: pd.DataFrame, name: str) -> pd.Series | None:
    exact = board[board["Player"] == name]
    if len(exact):
        return exact.iloc[0]
    from src.data import _normalize_name
    k = _normalize_name(pd.Series([name])).iloc[0]
    m = board[_normalize_name(board["Player"]) == k]
    return m.iloc[0] if len(m) else None


def validate_movers(board: pd.DataFrame) -> pd.DataFrame:
    """Predicted V1/multiplier vs each real 2026 mover's reported outcome."""
    with open(_DATA / "historical_breakouts.json") as f:
        movers = json.load(f)["actual_2026_movers"]
    rows = []
    for m in movers:
        r = _find_row(board, m["name"])
        real_eur = m.get("transfer_fee_eur") or m.get("reported_price_post_eur")
        real_mult = m.get("implied_multiplier") or m.get("realized_multiplier")
        rows.append({
            "name": m["name"], "status": m["status"],
            "pred_M": round(float(r["M"]), 2) if r is not None else None,
            "pred_V1_eur": float(r["V1"]) if r is not None else None,
            "real_mult": real_mult, "real_eur": real_eur,
            "ratio_pred_over_real": (round(float(r["V1"]) / real_eur, 2)
                                     if (r is not None and real_eur) else None),
        })
    return pd.DataFrame(rows)


def summary(board: pd.DataFrame) -> dict:
    v = validate_movers(board)
    ratios = v["ratio_pred_over_real"].dropna()
    return {
        "james": james_check(bo.K),
        "movers": v.to_dict("records"),
        "median_pred_over_real": round(float(ratios.median()), 2) if len(ratios) else None,
        "note": ("Predicted V1 is a destination-agnostic value; a specific super-club's "
                 "buyer premium (applied in the destination step) lifts it further, which "
                 "is why confirmed record fees sit above the neutral V1."),
    }


if __name__ == "__main__":  # quick manual check
    from destination.src import fee_bridge as fb
    from worldcup.src import squad_strength_v2 as ssv2
    from wcstars.src import tournament_data as td
    art = fb.load_model()
    board = bo.compute_board(td.attach_signals(ssv2.load_player_pool_2526()), art)
    print(json.dumps(summary(board), ensure_ascii=False, indent=2, default=float))
