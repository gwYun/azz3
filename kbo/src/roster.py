"""Roster, lineup, and playing-time preset engine (v2, user step 5).

Given a team's full set of valued players, this builds the depth chart and allocates
playing time — the manager behavior the user described: "잘 하는 선수를 우선 기용하되
어느 정도 선수단을 전체적으로 기용" (lean on the best, but spread the load across the
squad). Two allocation modes:

  * `actual`  — use each player's real PA/IP (for the backtest: validate the engine on
    real playing time).
  * `preset`  — allocate by a value-ranked, capped, breadth-controlled profile (for
    forward projection like 2026, and for a preset-driven backtest). The `breadth` knob
    is the star-vs-depth dial: low = ride the stars, high = spread the load.

Team run production consumes these as PA/IP *weights* (team_build.py): team offense is
the PA-weighted mean wOBA, team run prevention the IP-weighted mean FIP — so `breadth`
directly controls how much the bench/back-of-rotation drags a team toward league average.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config

# A realistic lineup: 1 C, 4 IF, 3 OF, 1 DH. Rotation 5 SP; the rest is the bullpen.
LINEUP_SLOTS = {"C": 1, "IF": 4, "OF": 3, "DH": 1}
ROTATION_SIZE = 5
# Playing-time realism: nobody exceeds ~700 PA / a starter's ~200 IP.
_PA_CAP = 700.0
_SP_BASE_IP, _RP_BASE_IP = 150.0, 55.0


def _rank_weights(n: int, breadth: float) -> np.ndarray:
    """Value-ranked exponential weights (rank 0 = best). Higher breadth = flatter."""
    return np.exp(-np.arange(n) / max(breadth, 0.5))


def build_lineup(batters: pd.DataFrame) -> pd.DataFrame:
    """Pick the starting nine by WAR within position needs; flag starters."""
    b = batters.sort_values("WAR", ascending=False).copy()
    b["is_starter"] = False
    used = set()
    for pos, k in LINEUP_SLOTS.items():
        if pos == "DH":
            pool = b[~b.index.isin(used)]                 # DH = best remaining bat
        else:
            pool = b[(b["position"] == pos) & (~b.index.isin(used))]
        pick = pool.head(k).index
        b.loc[pick, "is_starter"] = True
        used.update(pick)
    return b


def allocate_batting(batters: pd.DataFrame, breadth: float = 6.0,
                     mode: str = "preset", team_pa: int = config.TEAM_PA_PER_SEASON) -> pd.DataFrame:
    """Return the batting frame with an `alloc_pa` playing-time column."""
    b = build_lineup(batters)
    if mode == "actual":
        b["alloc_pa"] = b["PA"].astype(float)
        return b
    b = b.sort_values("WAR", ascending=False).reset_index(drop=True)
    w = _rank_weights(len(b), breadth)
    alloc = np.minimum(w / w.sum() * team_pa, _PA_CAP)
    # one redistribution pass so the cap doesn't lose team PA
    deficit = team_pa - alloc.sum()
    room = _PA_CAP - alloc
    if deficit > 0 and room.sum() > 0:
        alloc = alloc + room * (deficit / room.sum())
    b["alloc_pa"] = alloc
    return b


def build_staff(pitchers: pd.DataFrame) -> pd.DataFrame:
    """Rotation = top 5 SP by WAR; everyone else is the bullpen."""
    p = pitchers.sort_values("WAR", ascending=False).copy()
    sp = p[p["role"] == "SP"].head(ROTATION_SIZE).index
    p["staff_role"] = np.where(p.index.isin(sp), "rotation", "bullpen")
    return p


def allocate_pitching(pitchers: pd.DataFrame, breadth: float = 6.0,
                      mode: str = "actual", team_ip: int = config.TEAM_IP_PER_SEASON) -> pd.DataFrame:
    """Return the pitching frame with an `alloc_ip` workload column."""
    p = build_staff(pitchers)
    if mode == "actual":
        p["alloc_ip"] = p["IP"].astype(float)
        return p
    p = p.sort_values(["staff_role", "WAR"], ascending=[True, False]).reset_index(drop=True)
    base = np.where(p["staff_role"] == "rotation", _SP_BASE_IP, _RP_BASE_IP)
    # rank within each role group
    w = np.ones(len(p))
    for role in ("rotation", "bullpen"):
        m = (p["staff_role"] == role).to_numpy()
        w[m] = _rank_weights(int(m.sum()), breadth)
    raw = base * w
    p["alloc_ip"] = raw / raw.sum() * team_ip
    return p


def team_roster(season: int, franchise: str, values: dict, breadth: float = 6.0,
                mode: str = "actual") -> dict:
    """Build one team's allocated batting + pitching for a season."""
    bat = values["batters"]
    pit = values["pitchers"]
    b = bat[bat["franchise"] == franchise]
    p = pit[pit["franchise"] == franchise]
    return {
        "batting": allocate_batting(b, breadth, mode),
        "pitching": allocate_pitching(p, breadth, mode),
    }


if __name__ == "__main__":
    from . import league_constants as lc, player_value as pv
    c = lc.open_constants(2015)
    vals = pv.season_values(2015, c)
    r = team_roster(2015, "OB", vals, mode="preset")   # 2015 champion Doosan
    b = r["batting"].head(11)
    print("Doosan 2015 preset lineup/PA:")
    print(b[["name", "position", "is_starter", "PA", "alloc_pa", "wRC_plus"]].round(1).to_string(index=False))
    print("ΣPA:", round(r["batting"]["alloc_pa"].sum()), "ΣIP:", round(r["pitching"]["alloc_ip"].sum()))
