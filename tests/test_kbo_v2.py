"""Invariant tests for the KBO v2 bottom-up engine (network-free, synthetic inputs).

Guards the pieces that don't need the open-data download: the at-bat-code decoder, the
salary curve, the playing-time allocation, and the positional WAR adjustment.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from kbo.src import boxscore_data as bd, salary_model as sal, roster, config, data
from kbo.src import player_value as pv, matchup_export as mx

_LG = {"bb": 0.090, "b1": 0.150, "b2": 0.045, "b3": 0.005, "hr": 0.028, "out": 0.682}
_LG_FULL = {"event": _LG, "hit_split_nonhr": {"b1": 0.75, "b2": 0.22, "b3": 0.03}}


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
    # Salary is display-only (the sim reads WAR); test_sim_uses_war_not_salary is the guard.


def test_salary_reference_loads():
    ref = data.load_salary_reference()
    assert len(ref) == 99                                          # 95 statiz + 4 KBO-official
    assert ref["source"].value_counts()["statiz"] == 95
    assert ref["franchise"].notna().all()                         # every team name resolves
    und = ref[ref["source"] == "kbo_official_undisclosed"]
    assert len(und) == 2 and und["salary_won"].isna().all()       # 미공개 → NaN
    assert (~und["is_disclosed"]).all()
    # 2026+ WAR values are projections; the flag must exclude them from the diagnostic.
    assert (~ref.loc[ref["season"] >= config.CURRENT_SEASON, "war_realized"]).all()
    assert ref.loc[ref["season"] < config.CURRENT_SEASON, "war_realized"].all()


def test_team_salary_2026_loads():
    tm = data.load_team_salary_2026()
    assert len(tm) == 10 and tm["franchise"].nunique() == 10       # all 10 franchises
    ordered = tm.sort_values("avg_salary_won", ascending=False)
    assert ordered.iloc[0]["team_ko"] == "SSG"                    # top payroll
    assert ordered.iloc[-1]["team_ko"] == "키움"                   # bottom (rebuild)


def test_salary_diagnostics_level_calibrated():
    d = sal.evaluate_against_reference()
    assert set(d) >= {"n", "r2_level", "median_real_over_est", "corr_war_salary"}
    assert d["n"] > 50
    # The curve is LEVEL-calibrated: its median matches real top-earner salaries.
    assert 0.7 < d["median_real_over_est"] < 1.4                  # magnitude is right
    # But the SLOPE is not fit — the censored sample has corr≈0 and no per-player power.
    # These guard against a future slope-refit that would collapse the curve to a constant.
    assert abs(d["corr_war_salary"]) < 0.2                       # WAR doesn't predict salary
    assert d["r2_level"] < 0                                      # per-player error stays large


def test_sim_uses_war_not_salary():
    # The winning-environment factor must depend on WAR (talent), not estimated salary.
    # Multiplying every salary by 5 must leave team rs/ra untouched, while the env is
    # actually active (not all 1.0) — proving the sim reads WAR, not the salary proxy.
    from kbo.src import team_build as tb, live2026
    c, raw = live2026.build_2026_raw()
    params = dict(breadth=6.0, mode="actual", wexp_weight=0.04, tactics_weight=1.0, fip_blend=0.25)

    def vals():
        return {"batters": sal.add_salary(pv.batter_value(raw["batters"], c)),
                "pitchers": sal.add_salary(pv.pitcher_value(raw["pitchers"], c))}

    base = tb.build_team_ratings(2026, constants=c, values=vals(), **params)
    bumped = vals()
    bumped["batters"]["est_salary_won"] *= 5
    bumped["pitchers"]["est_salary_won"] *= 5
    hi = tb.build_team_ratings(2026, constants=c, values=bumped, **params)

    assert (base["winning_env"] != 1.0).any()                     # env is active
    assert np.allclose(base["rs_per_game"], hi["rs_per_game"])    # salary doesn't move offense
    assert np.allclose(base["ra_per_game"], hi["ra_per_game"])    # …or run prevention
    assert (base["payroll_ok"] != hi["payroll_ok"]).any()        # payroll (display) did change


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


# --------------------------------------------------------------------------- #
# Matchup predictor (야구 승부 예측).                                          #
# --------------------------------------------------------------------------- #
def test_batter_rates_form_multinomial():
    row = pd.Series({"PA": 400, "BB": 50, "HBP": 5, "B1": 70, "B2": 25, "B3": 2, "HR": 18})
    r = mx.batter_rates(row, _LG_FULL)
    assert abs(sum(r.values()) - 1.0) < 1e-5          # rates rounded to 6dp for JSON
    assert all(0.0 <= v <= 1.0 for v in r.values())
    row0 = pd.Series({"PA": 0, "BB": 0, "HBP": 0, "B1": 0, "B2": 0, "B3": 0, "HR": 0})
    assert mx.batter_rates(row0, _LG_FULL) is None


def test_pitcher_rates_bf_fallback_and_valid():
    # No TBF -> BF estimated as 3*IP + H + BB + HBP; rates stay a valid simplex.
    row = pd.Series({"IP": 100.0, "H": 90, "HR": 10, "BB": 30, "HBP": 4, "TBF": float("nan")})
    r = mx.pitcher_rates(row, _LG_FULL)
    assert abs(sum(r.values()) - 1.0) < 1e-5          # rates rounded to 6dp for JSON
    assert all(v >= 0.0 for v in r.values())


def test_matchup_log5_suppresses_vs_tougher_pitcher():
    """A HR-suppressing pitcher lowers the batter's realized HR share (log5 direction)."""
    bvec = [_LG[e] for e in mx.EVENTS]
    lgv = list(bvec)
    neutral = list(bvec)
    tough = list(bvec); tough[4] = bvec[4] * 0.4          # allows 60% fewer HR
    hr_neutral = mx._matchup_dist(bvec, neutral, lgv)[4]
    hr_tough = mx._matchup_dist(bvec, tough, lgv)[4]
    assert hr_tough < hr_neutral


def test_markov_order_sensitive():
    def R(bb, b1, b2, b3, hr):
        return {"bb": bb, "b1": b1, "b2": b2, "b3": b3, "hr": hr, "out": 1 - (bb + b1 + b2 + b3 + hr)}
    strong = R(0.12, 0.17, 0.06, 0.004, 0.05)
    weak = R(0.06, 0.13, 0.03, 0.002, 0.01)
    top = [strong] * 4 + [weak] * 5
    bottom = [weak] * 5 + [strong] * 4
    mu_top = mx.markov_expected_runs(top, _LG, _LG, _LG, 6, False)
    mu_bottom = mx.markov_expected_runs(bottom, _LG, _LG, _LG, 6, False)
    assert mu_top > mu_bottom                                    # best hitters up top score more
    assert 0.0 < (mu_top - mu_bottom) < 1.0                      # but the effect is modest


def test_markov_home_factor():
    from kbo.src.game_model import HOME_FACTOR
    order = [_LG] * 9
    away = mx.markov_expected_runs(order, _LG, _LG, _LG, 6, False)
    home = mx.markov_expected_runs(order, _LG, _LG, _LG, 6, True)
    assert abs(home - away * HOME_FACTOR) < 1e-9


def test_markov_parity_fixture():
    """Pin the Python reference to the committed fixture the TS engine also checks."""
    fx = json.loads((config.PROJECT_ROOT / "web" / "lib" / "__fixtures__" /
                     "markov-parity.json").read_text())
    lg = fx["lg_event"]
    for c in fx["cases"]:
        mu = mx.markov_expected_runs(c["order"], c["sp"], c["pen"], lg,
                                     c["sp_innings"], c["home"], c["elite"], c["calib"])
        assert abs(mu - c["mu"]) < 1e-9, c["label"]
