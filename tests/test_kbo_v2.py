"""Invariant tests for the KBO v2 bottom-up engine (network-free, synthetic inputs).

Guards the pieces that don't need the open-data download: the at-bat-code decoder, the
salary curve, the playing-time allocation, and the positional WAR adjustment.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from kbo.src import boxscore_data as bd, salary_model as sal, roster
from kbo.src import player_value as pv


def _synthetic_batter_games():
    """One player, two games, with known at-bat codes across the inning columns."""
    base = {"선수명": "X", "year": 2015, "팀": "두산", "포지션": "8"}
    inn = {f"i_{k}": 0 for k in range(1, 13)}
    g1 = {**base, "date": "2015-04-01", "안타": 3, "타수": 4, "타점": 1, "득점": 1, **inn,
          "i_1": 1300, "i_2": 1020, "i_3": 1100, "i_4": 3000, "i_5": 3100}  # HR,1B,2B,BB,HBP
    g2 = {**base, "date": "2015-04-02", "안타": 1, "타수": 3, "타점": 0, "득점": 0, **inn,
          "i_1": 1200, "i_2": 3200, "i_3": 5000}  # 3B, IBB, SF
    return pd.DataFrame([g1, g2])


def test_atbat_decode_counts():
    out = bd._decode_batting(_synthetic_batter_games())
    r = out.iloc[0]
    assert r["HR"] == 1 and r["B1"] == 1 and r["B2"] == 1 and r["B3"] == 1
    assert r["HBP"] == 1 and r["SF"] == 1
    assert r["IBB"] == 1 and r["uBB"] == 1 and r["BB"] == 2   # uBB + IBB
    # decoded hit types reconcile with 안타 sum (3 + 1 = 4 = 1B+2B+3B+HR)
    assert r["B1"] + r["B2"] + r["B3"] + r["HR"] == r["H"]
    assert r["G"] == 2


def test_salary_floor_and_monotonic():
    assert sal.est_salary_won(0) == sal.MIN_SALARY_WON
    assert sal.est_salary_won(-5) == sal.MIN_SALARY_WON            # clamped at floor
    vals = [sal.est_salary_won(w) for w in [0, 1, 3, 5, 8]]
    assert all(b > a for a, b in zip(vals, vals[1:]))             # strictly increasing
    assert sal.est_salary_won(8) <= sal.MAX_SALARY_WON


def test_playing_time_allocation():
    n = 25
    bat = pd.DataFrame({
        "name": [f"b{i}" for i in range(n)],
        "WAR": np.linspace(6, -0.5, n),
        "position": (["C"] * 2 + ["IF"] * 9 + ["OF"] * 9 + ["DH"] * 5),
        "PA": np.linspace(600, 20, n),
    })
    a = roster.allocate_batting(bat, breadth=6.0, mode="preset", team_pa=5700)
    assert abs(a["alloc_pa"].sum() - 5700) < 1.0                  # conserves team PA
    assert a["alloc_pa"].max() <= roster._PA_CAP + 1e-6           # nobody exceeds the cap
    assert a[a["WAR"] > 4]["alloc_pa"].mean() > a[a["WAR"] < 1]["alloc_pa"].mean()  # stars play more
    assert a["is_starter"].sum() == 9                            # a full lineup


def test_positional_adjustment_in_war():
    """At equal offense, a catcher is worth more WAR than a DH (positional value)."""
    c = {"lg_wOBA": 0.33, "wOBA_scale": 1.05, "lg_R_per_PA": 0.13, "RPW": 10.5,
         "replacement_runs_per_600pa": 20.0}
    bat = pd.DataFrame([
        {"name": "catcher", "position": "C", "PA": 600, "AB": 540, "H": 160, "B1": 100,
         "B2": 40, "B3": 2, "HR": 18, "BB": 55, "IBB": 3, "HBP": 6, "SF": 5, "SO": 0},
        {"name": "dh", "position": "DH", "PA": 600, "AB": 540, "H": 160, "B1": 100,
         "B2": 40, "B3": 2, "HR": 18, "BB": 55, "IBB": 3, "HBP": 6, "SF": 5, "SO": 0},
    ])
    out = pv.batter_value(bat, c)
    war = dict(zip(out["name"], out["WAR"]))
    assert war["catcher"] > war["dh"]
