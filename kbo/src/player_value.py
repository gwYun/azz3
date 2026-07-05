"""Player value tool (v2, user step 2) — per-player WAR / wRC+ / FIP.

Extends v1 `sabermetrics` now that real POSITIONS exist in the open dump: batting WAR
gets a positional adjustment (catchers and up-the-middle players are worth more than
corner/DH bats at the same wOBA). Baserunning is still omitted — the open batting dump
carries no SB/CS — and disclosed. Pitching WAR is the v1 FIP-based proxy.

These per-player values feed the salary estimator, the roster/lineup builder, and the
web leaderboard. They do NOT drive the game simulator's run production (that uses wOBA→
runs directly), so the positional adjustment stays a value-accounting term, not a
double-count of run scoring.
"""
from __future__ import annotations

import pandas as pd

from . import sabermetrics as sm

# Positional adjustment, runs per 600 PA (coarse buckets from the open dump's positions).
# Standard shape: C most valuable defensively, DH least; IF ~ up-the-middle average.
_POS_ADJ = {"C": 12.0, "IF": 2.0, "OF": -1.0, "DH": -15.0, "PH": -12.0, "PR": -12.0, "P": 0.0}


def batter_value(bat: pd.DataFrame, c: dict) -> pd.DataFrame:
    """Add wOBA/wRAA/wRC+/WAR to a batting frame (WAR includes a positional adjustment)."""
    out = sm.add_batting_metrics(bat, c)          # wOBA, wRAA, wRC_plus, WAR (offense-only)
    pos_adj = out["position"].map(_POS_ADJ).fillna(0.0)
    repl = c["replacement_runs_per_600pa"]
    # Replace v1's offense-only WAR with wRAA + (positional + replacement) runs, ÷ RPW.
    rar = out["wRAA"] + (out["PA"] / 600.0) * (pos_adj + repl)
    out["WAR"] = rar / c["RPW"]
    return out


def pitcher_value(pit: pd.DataFrame, c: dict) -> pd.DataFrame:
    """Add FIP/WAR to a pitching frame (FIP-based RAR; SP/RP split already in the data)."""
    return sm.add_pitching_metrics(pit, c)


def season_values(season: int, constants: dict) -> dict[str, pd.DataFrame]:
    """Full-roster batter + pitcher value tables for a season (from the open dump)."""
    from . import boxscore_data as bd
    return {"batters": batter_value(bd.batting(season), constants),
            "pitchers": pitcher_value(bd.pitching(season), constants)}


if __name__ == "__main__":
    from . import league_constants as lc
    c = lc.open_constants(2015)
    v = season_values(2015, c)
    b = v["batters"].sort_values("WAR", ascending=False).head(6)
    print("2015 WAR leaders (batters):")
    print(b[["name", "franchise", "position", "PA", "HR", "wRC_plus", "WAR"]].round(2).to_string(index=False))
    p = v["pitchers"].sort_values("WAR", ascending=False).head(5)
    print("\n2015 WAR leaders (pitchers):")
    print(p[["name", "franchise", "role", "IP", "SO", "ERA", "FIP", "WAR"]].round(2).to_string(index=False))
