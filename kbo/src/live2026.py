"""2026-live roster values (v2) — real /Record regulars + a team-total-anchored depth fill.

The open full-roster dump ends in 2020 and box scores are robots-blocked, so the live
2026 forecast can't use full real rosters. Instead it takes the **real qualified
regulars** from the robots-allowed KBO `/Record` pages (v1 loaders) as individual
players, and represents the rest of each roster as a single **residual** row = the
team's actual `/Record` season total minus its qualified players. Because the residual
is the real aggregate of the non-qualified players, each team's rolled-up offense/run-
prevention equals its true team totals — the bottom-up decomposition stays anchored to
reality (no arbitrary replacement level), while still valuing the stars individually.

Positions aren't on the /Record ranking pages, so batters default to an infield bucket
(a neutral positional adjustment); it affects only player WAR display, not team rs/ra.
The bench decomposition is coarse (one residual row) — disclosed; the engine is validated
on full real rosters by the 2015-2019 backtest.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import data, league_constants as lc

_BAT_COUNT = ["PA", "AB", "H", "B1", "B2", "B3", "HR", "BB", "IBB", "HBP", "SF", "R"]
_PIT_COUNT = ["IP", "H", "HR", "BB", "HBP", "SO", "R", "ER"]   # FIP/RA9 inputs (no BF needed)


def _residual_batters(players: pd.DataFrame, team_tot: pd.DataFrame) -> pd.DataFrame:
    """One residual batting row per team = team total − its qualified players."""
    qsum = players.groupby("franchise")[_BAT_COUNT].sum()
    rows = []
    for f in team_tot["franchise"]:
        tt = team_tot.set_index("franchise").loc[f]
        q = qsum.loc[f] if f in qsum.index else 0
        res = {c: max(0.0, float(tt[c]) - float(q[c] if hasattr(q, "__getitem__") else 0)) for c in _BAT_COUNT}
        res.update({"name": "(bench)", "franchise": f, "position": "IF", "SO": 0})
        rows.append(res)
    return pd.DataFrame(rows)


def _residual_pitchers(players: pd.DataFrame, team_tot: pd.DataFrame) -> pd.DataFrame:
    qsum = players.groupby("franchise")[_PIT_COUNT].sum()
    rows = []
    for f in team_tot["franchise"]:
        tt = team_tot.set_index("franchise").loc[f]
        q = qsum.loc[f] if f in qsum.index else 0
        res = {c: max(0.0, float(tt[c]) - float(q[c] if hasattr(q, "__getitem__") else 0)) for c in _PIT_COUNT}
        res.update({"name": "(bullpen/depth)", "franchise": f, "role": "RP"})
        rows.append(res)
    return pd.DataFrame(rows)


def build_2026_raw(season: int = 2026):
    """(constants, raw) for the 2026-live forecast, ready for team_build(raw=...)."""
    c = lc.compute_constants(season)
    b = data.player_batting(season).copy()
    p = data.player_pitching(season).copy()
    tb_tot = data.team_batting(season)
    tp_tot = data.team_pitching(season)

    b["position"] = "IF"                        # /Record ranking carries no position
    p["role"] = np.where(p["IP"] / p["G"].clip(lower=1) > 4.0, "SP", "RP")

    batters = pd.concat([b, _residual_batters(b, tb_tot)], ignore_index=True)
    pitchers = pd.concat([p, _residual_pitchers(p, tp_tot)], ignore_index=True)
    return c, {"batters": batters, "pitchers": pitchers}


if __name__ == "__main__":
    from . import team_build as tb
    c, raw = build_2026_raw()
    r = tb.build_team_ratings(2026, constants=c, raw=raw, mode="actual")
    print("2026 bottom-up (regulars + team-total-anchored depth):")
    print(r[["ko", "rs_per_game", "ra_per_game", "off_rating", "def_rating",
             "proj_wins", "payroll_ok"]].round(2).to_string())
