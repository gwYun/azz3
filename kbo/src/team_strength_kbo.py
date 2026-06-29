"""STAGE 1 (KBO) — per-franchise offense + run-prevention ratings.

The baseball analog of pl/src/squad_strength_pl.build_club_ratings, with the two
deltas the plan calls out:

  * **Two ratings, not one.** A club collapses to a single soccer rating because its
    Poisson match model is symmetric; baseball carries a separate `off_rating`
    (run-scoring) and `def_rating` (run-prevention), since the game model needs both
    expected-runs-scored and expected-runs-allowed.
  * **Additive, no synergy.** Run production is ~additive, so there is no spine /
    chemistry multiplier — the projection (player_project.project_team_factors) is
    rolled straight into ratings.

`off_rating`/`def_rating` are display scores (mean 100, sd 15, like the soccer
rating). What the SIMULATOR actually consumes is `rs_per_game`/`ra_per_game` (the
projected absolute run rates) — exposed unchanged. `proj_wins` is the Pythagenpat
talent estimate (a Stage-1 sanity deliverable, like pl's mean_points).

The only knobs (`proj_w`/`prior_w`, `regress`) are the disclosed projection blend the
sensitivity grid sweeps; nothing is tuned to a chosen champion.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config, data
from .player_project import project_team_factors

# Pythagenpat: exponent x = RPG^0.287 (RPG = combined runs per game), then
# win% = RS^x / (RS^x + RA^x). The standard run-environment-aware Pythagorean.
_PYTHAG_EXP = 0.287


def pythag_winpct(rs_per_game, ra_per_game):
    rpg = rs_per_game + ra_per_game
    x = np.power(rpg, _PYTHAG_EXP)
    return np.power(rs_per_game, x) / (np.power(rs_per_game, x) + np.power(ra_per_game, x))


def _zscore(s: pd.Series) -> pd.Series:
    sd = s.std(ddof=0)
    return (s - s.mean()) / sd if sd > 0 else s * 0.0


def build_team_ratings(forecast_season: int = config.CURRENT_SEASON,
                       proj_w: float = 0.6, prior_w: float = 0.4,
                       regress: float = 0.30) -> pd.DataFrame:
    """Stage-1 deliverable: one offense + one defense rating per franchise.

    Returns a frame indexed by franchise code, sorted by projected wins, with the
    columns the simulator (rs/ra per game) and the web/report (ratings, ko/en) need.
    """
    tf = project_team_factors(forecast_season, proj_w=proj_w, prior_w=prior_w,
                              regress=regress)

    df = pd.DataFrame(index=tf.index)
    df["rs_per_game"] = tf["rs_per_game"]
    df["ra_per_game"] = tf["ra_per_game"]

    # Display ratings (mean 100, sd 15). Offense up with runs scored; defense up with
    # FEWER runs allowed (so we z-score the negative of the runs-allowed rate).
    df["off_rating"] = 100.0 + 15.0 * _zscore(tf["off_factor"])
    df["def_rating"] = 100.0 + 15.0 * _zscore(-tf["def_factor"])
    df["overall_rating"] = 0.5 * (df["off_rating"] + df["def_rating"])

    # Pythagenpat talent wins over a full 144-game season (schedule-neutral).
    df["pythag_winpct"] = pythag_winpct(df["rs_per_game"], df["ra_per_game"])
    df["proj_wins"] = (df["pythag_winpct"] * config.GAMES_PER_TEAM).round(1)

    df["ko"] = [data.TEAM_KO[f] for f in df.index]
    df["en"] = [data.TEAM_EN[f] for f in df.index]
    return df.sort_values("proj_wins", ascending=False)


if __name__ == "__main__":
    r = build_team_ratings(2026)
    print(r[["ko", "rs_per_game", "ra_per_game", "off_rating", "def_rating",
             "proj_wins"]].round(2).to_string())
    print("\nproj_wins sum (should ~ 0.5 * 144 * 10 = 720):", round(r["proj_wins"].sum(), 1))
