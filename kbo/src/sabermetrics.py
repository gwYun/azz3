"""In-house KBO sabermetrics: wOBA, wRC+, FIP, and a simplified WAR.

Computed from raw counting stats with the per-season KBO constants in
`league_constants.py` — NOT copied from statiz. Works on either the player tables
(`data.player_batting/pitching`) or the team tables (`data.team_batting/pitching`),
since both share the canonical column names.

v1 WAR is an explicit, disclosed simplification — a runs-above-replacement proxy:
  * Batting WAR uses wRAA + a flat replacement credit. It omits the positional
    adjustment (the ranking pages carry no fielding position) and baserunning
    (no SB/CS on these tabs), so it is closer to an *offensive* WAR.
  * Pitching WAR is FIP-based (defense-independent) with a replacement-level FIP,
    no starter/reliever split.
This is enough to (a) rank players and (b) sum to team offense/defense ratings,
which is all the simulator consumes. Park factors are neutral in v1 (see
league_constants).
"""
from __future__ import annotations

import pandas as pd

from .league_constants import WOBA_WEIGHTS


def woba(bat: pd.DataFrame, c: dict) -> pd.Series:
    """Weighted on-base average. `bat` has canonical batting columns; `c` constants."""
    w = WOBA_WEIGHTS
    uBB = bat["BB"] - bat["IBB"]
    num = (w["BB"] * uBB + w["HBP"] * bat["HBP"] + w["1B"] * bat["B1"]
           + w["2B"] * bat["B2"] + w["3B"] * bat["B3"] + w["HR"] * bat["HR"])
    den = bat["AB"] + bat["BB"] - bat["IBB"] + bat["SF"] + bat["HBP"]
    return num / den.replace(0, pd.NA)


def wraa(bat: pd.DataFrame, c: dict) -> pd.Series:
    """Weighted runs above average."""
    wo = woba(bat, c)
    return ((wo - c["lg_wOBA"]) / c["wOBA_scale"]) * bat["PA"]


def wrc_plus(bat: pd.DataFrame, c: dict) -> pd.Series:
    """wRC+ (100 = league average), park-neutral in v1."""
    wrc_per_pa = (wraa(bat, c) / bat["PA"].replace(0, pd.NA)) + c["lg_R_per_PA"]
    return 100.0 * wrc_per_pa / c["lg_R_per_PA"]


def fip(pit: pd.DataFrame, c: dict) -> pd.Series:
    """Fielding-independent pitching, on the ERA scale via the KBO FIP constant."""
    ip = pit["IP"].replace(0, pd.NA)
    return (13 * pit["HR"] + 3 * (pit["BB"] + pit["HBP"]) - 2 * pit["SO"]) / ip + c["FIP_const"]


def batting_war(bat: pd.DataFrame, c: dict) -> pd.Series:
    """Simplified batting WAR (offense-only proxy; see module docstring)."""
    rar = wraa(bat, c) + (bat["PA"] / 600.0) * c["replacement_runs_per_600pa"]
    return rar / c["RPW"]


def pitching_war(pit: pd.DataFrame, c: dict) -> pd.Series:
    """Simplified FIP-based pitching WAR (no SP/RP split; see module docstring)."""
    repl_fip = c["lg_FIP"] * c["replacement_fip_factor"]
    runs_above_repl = (repl_fip - fip(pit, c)) * (pit["IP"] / 9.0)
    return runs_above_repl / c["RPW"]


def add_batting_metrics(bat: pd.DataFrame, c: dict) -> pd.DataFrame:
    out = bat.copy()
    out["wOBA"] = woba(out, c)
    out["wRAA"] = wraa(out, c)
    out["wRC_plus"] = wrc_plus(out, c)
    out["WAR"] = batting_war(out, c)
    return out


def add_pitching_metrics(pit: pd.DataFrame, c: dict) -> pd.DataFrame:
    out = pit.copy()
    out["FIP"] = fip(out, c)
    out["WAR"] = pitching_war(out, c)
    return out
