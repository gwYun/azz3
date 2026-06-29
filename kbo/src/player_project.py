"""Forward projections (Marcel-style) for the forecast season.

Two projections, mirroring the soccer Stage-1 split but adapted to what KBO open
data supplies completely:

  * `project_team_factors` — the one the SIMULATOR consumes. For each franchise it
    projects an offense factor (runs scored vs league) and a defense factor (runs
    allowed vs league) for the forecast season, from the prior `lookback` completed
    seasons. Built on TEAM-season totals, which cover every plate appearance, so it
    needs no full-roster player data. Marcel weighting (recent seasons heavier) +
    regression toward league average (team results are part luck and rosters turn
    over), then an optional blend with last season's raw factor.

  * `project_players` — the leaderboard/"player value" deliverable. Projects each
    qualified player's wRC+ / WAR by the same Marcel logic across seasons (matched on
    name). Secondary: it does not feed the simulator.

KBO franchise talent year-over-year is ~0.5 correlated, so a single season heavily
regressed is the right prior; the defaults below reflect that and are exposed as
knobs the sensitivity grid sweeps (like pl's model_w/tm_w).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config, data, league_constants as lc, sabermetrics as sm

# Marcel-style recency weights for the lookback seasons (most-recent first).
_MARCEL_WEIGHTS = [5.0, 4.0, 3.0]


def _weights(n: int) -> list[float]:
    return _MARCEL_WEIGHTS[:n] if n <= len(_MARCEL_WEIGHTS) else \
        _MARCEL_WEIGHTS + [_MARCEL_WEIGHTS[-1]] * (n - len(_MARCEL_WEIGHTS))


def lookback_seasons(forecast_season: int, lookback: int = config.PROJECTION_LOOKBACK) -> list[int]:
    """The completed seasons feeding a forecast, most-recent first (e.g. 2025,2024,2023)."""
    return [forecast_season - k for k in range(1, lookback + 1)]


def _team_factors_one_season(season: int) -> pd.DataFrame:
    """Per-franchise offense/defense factors (vs that season's league R/G)."""
    tb = data.team_batting(season)[["franchise", "G", "R"]].rename(columns={"R": "RS"})
    tp = data.team_pitching(season)[["franchise", "R"]].rename(columns={"R": "RA"})
    c = lc.compute_constants(season)
    df = tb.merge(tp, on="franchise")
    df["off_factor"] = (df["RS"] / df["G"]) / c["lg_R_per_G"]   # >1 better offense
    df["def_factor"] = (df["RA"] / df["G"]) / c["lg_R_per_G"]   # <1 better prevention
    df["season"] = season
    return df[["franchise", "season", "off_factor", "def_factor"]]


def project_team_factors(forecast_season: int = config.CURRENT_SEASON,
                         lookback: int = config.PROJECTION_LOOKBACK,
                         regress: float = 0.30, proj_w: float = 0.6,
                         prior_w: float = 0.4) -> pd.DataFrame:
    """Projected offense/defense factors + absolute RS/RA per game for each franchise.

    regress  — fraction the Marcel-weighted factor is pulled toward 1.0 (league avg).
    proj_w/prior_w — blend of the regressed projection vs last season's raw factor.
    """
    seasons = lookback_seasons(forecast_season, lookback)
    hist = pd.concat([_team_factors_one_season(s) for s in seasons], ignore_index=True)

    w = dict(zip(seasons, _weights(len(seasons))))     # season -> Marcel weight
    hist["w"] = hist["season"].map(w)

    def _wavg(g, col):
        return np.average(g[col], weights=g["w"])

    franchises = sorted(hist["franchise"].unique())
    rows = []
    prior_season = seasons[0]
    prior = hist[hist["season"] == prior_season].set_index("franchise")
    for f in franchises:
        g = hist[hist["franchise"] == f]
        off_w = _wavg(g, "off_factor")
        def_w = _wavg(g, "def_factor")
        # regress toward league average (1.0)
        off_proj = 1.0 + (off_w - 1.0) * (1.0 - regress)
        def_proj = 1.0 + (def_w - 1.0) * (1.0 - regress)
        # blend with last season's raw factor
        off = proj_w * off_proj + prior_w * float(prior.loc[f, "off_factor"])
        dfc = proj_w * def_proj + prior_w * float(prior.loc[f, "def_factor"])
        rows.append({"franchise": f, "off_factor": off, "def_factor": dfc})
    out = pd.DataFrame(rows).set_index("franchise")

    # Absolute scale: anchor to the most recent completed season's league R/G.
    lg_rg = lc.compute_constants(prior_season)["lg_R_per_G"]
    out["lg_R_per_G"] = lg_rg
    out["rs_per_game"] = out["off_factor"] * lg_rg
    out["ra_per_game"] = out["def_factor"] * lg_rg
    return out


# --------------------------------------------------------------------------- #
# Player leaderboard projection (secondary; does not feed the simulator).      #
# --------------------------------------------------------------------------- #
def _player_metric_history(forecast_season: int, lookback: int, is_pitcher: bool):
    seasons = lookback_seasons(forecast_season, lookback)
    frames = []
    for s in seasons:
        c = lc.compute_constants(s)
        if is_pitcher:
            df = sm.add_pitching_metrics(data.player_pitching(s), c)
            df = df[["name", "franchise", "season", "IP", "ERA", "FIP", "WAR"]]
        else:
            df = sm.add_batting_metrics(data.player_batting(s), c)
            df = df[["name", "franchise", "season", "PA", "HR", "wOBA", "wRC_plus", "WAR"]]
        frames.append(df)
    return pd.concat(frames, ignore_index=True), seasons


def project_players(forecast_season: int = config.CURRENT_SEASON,
                    lookback: int = config.PROJECTION_LOOKBACK,
                    is_pitcher: bool = False, regress: float = 0.35) -> pd.DataFrame:
    """Project qualified players' WAR (+ wRC+ or FIP) for the leaderboard, by name.

    Marcel-weighted across the seasons a player qualified, regressed toward a
    replacement-ish baseline (WAR -> 0) by `regress`. Players seen in only the most
    recent season are projected as a regressed version of that season. The franchise
    shown is the player's most recent.
    """
    hist, seasons = _player_metric_history(forecast_season, lookback, is_pitcher)
    w = dict(zip(seasons, _weights(len(seasons))))
    hist["w"] = hist["season"].map(w)
    metric = "WAR"
    extra = "FIP" if is_pitcher else "wRC_plus"

    rows = []
    for name, g in hist.groupby("name"):
        recent = g.sort_values("season").iloc[-1]
        war_w = np.average(g[metric], weights=g["w"])
        proj_war = war_w * (1.0 - regress)              # regress toward 0 (replacement)
        ex_w = np.average(g[extra], weights=g["w"])
        rows.append({"name": name, "franchise": recent["franchise"],
                     "proj_WAR": proj_war, f"proj_{extra}": ex_w,
                     "seasons": len(g)})
    return pd.DataFrame(rows).sort_values("proj_WAR", ascending=False).reset_index(drop=True)


if __name__ == "__main__":
    tf = project_team_factors(2026)
    print("=== projected team factors for 2026 ===")
    print(tf.round(3).sort_values("off_factor", ascending=False).to_string())
