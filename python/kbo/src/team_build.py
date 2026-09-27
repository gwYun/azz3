"""Bottom-up team ratings (v2, user step 4) — rosters → team rs/ra per game.

Replaces v1's team-total Marcel projection: instead of team season totals, each team's
offense and run prevention are rolled up from its actual players and their allocated
playing time (roster.py):

  * **Offense:** PA-weighted mean wOBA → an offensive index (≈ team wRC+/100) →
    `rs_per_game = lg_R_per_G × off_index`.
  * **Run prevention:** IP-weighted mean FIP → `ra_per_game = lg_R_per_G × (team_FIP/lg_FIP)`.

Then the **winning-environment factor** (user step 4): a *small, disclosed, ablatable*
modifier from team **talent** (Σ WAR — an investment/depth prior) and **synergy** (roster
balance: how many above-average players actually get playing time). Sized so it never
overrides on-field performance (`wexp_weight` defaults low and is a sensitivity axis).
Output feeds the unchanged v1 simulator via `rs_per_game`/`ra_per_game`.

The simulation depends on **WAR, not salary**: estimated salary/payroll is a display-only
valuation artifact and never enters the ratings (see `_team_metrics` / the env factor).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import data, league_constants as lc, player_value as pv, roster, salary_model
from . import manager_tactics as mt
from .team_strength_kbo import pythag_winpct, _zscore
from . import config


def _team_metrics(rb: pd.DataFrame, rp: pd.DataFrame, c: dict, aggression: float,
                  fip_blend: float) -> dict:
    rb = rb[rb["alloc_pa"] > 0]
    rp = rp[(rp["alloc_ip"] > 0) & (rp["IP"] > 0)]
    # Offense: PA-weighted mean wOBA -> off index (≈ team wRC+/100). Calibrated to actual.
    wpa = rb["alloc_pa"].to_numpy()
    team_woba = float((wpa * rb["wOBA"]).sum() / wpa.sum())
    team_wrc_per_pa = (team_woba - c["lg_wOBA"]) / c["wOBA_scale"] + c["lg_R_per_PA"]
    off_index = team_wrc_per_pa / c["lg_R_per_PA"]
    rs = c["lg_R_per_G"] * off_index * aggression

    # Run prevention: IP-weighted actual runs-allowed rate (RA9) — the pitching analog of
    # the batter's wOBA (real player output, includes defense/BABIP) — lightly blended
    # with FIP to stabilize small-sample relievers. Pure FIP under-disperses (strips
    # defense); pure RA9 is the truest descriptor.
    wip = rp["alloc_ip"].to_numpy()
    ra9 = (rp["R"] * 9.0 / rp["IP"].clip(lower=1e-6)).to_numpy()
    team_ra9 = float((wip * ra9).sum() / wip.sum())
    team_fip = float((wip * rp["FIP"]).sum() / wip.sum())
    def_rate = (1 - fip_blend) * team_ra9 + fip_blend * team_fip

    # Σ WAR is the sim's talent/investment prior (used by winning_env). Payroll (Σ
    # estimated salary) is computed alongside for DISPLAY ONLY — it never enters ratings.
    team_war = float(rb["WAR"].sum() + rp["WAR"].sum())
    payroll = float(rb["est_salary_won"].sum() + rp["est_salary_won"].sum())
    depth_bat = int(((rb["alloc_pa"] > 100) & (rb["wRC_plus"] > 100)).sum())
    depth_pit = int(((rp["alloc_ip"] > 20) & (rp["FIP"] < c["lg_FIP"])).sum())
    return {"rs": rs, "off_index": off_index, "def_rate": def_rate,
            "team_woba": team_woba, "team_fip": team_fip,
            "team_war": team_war, "payroll": payroll,
            "synergy_raw": depth_bat + depth_pit}


def build_team_ratings(season: int, constants: dict | None = None, breadth: float = 6.0,
                       mode: str = "actual", wexp_weight: float = 0.0,
                       tactics_weight: float = 1.0, fip_blend: float = 0.25,
                       rating_shrink: float = 1.0,
                       raw: dict | None = None, values: dict | None = None) -> pd.DataFrame:
    """One row per franchise: rs/ra per game + ratings + payroll/synergy/env.

    Source precedence: pre-valued `values` (2026-live with replacement fill) > `raw`
    canonical frames > the open dump for `season`. `raw`/`values` =
    {"batters", "pitchers"} frames with position/role.

    `rating_shrink` (<1) linearly pulls each team's rs/ra toward the league anchor
    (lg_R_per_G) before the sim. The roster→rate pipeline over-spreads teams — it
    underrates weak offenses and yields overconfident single-game favorites (2026:
    favorites predicted 0.70 win only 0.62). Shrinkage is a monotone transform, so it
    barely moves the standings ranking (ρ) while fixing game-level calibration and the
    overstated title odds. 0.70 was chosen on the 2015-2019 game-level log-loss and
    confirmed out-of-sample on 2026 (scripts/recalibrate.py). Default 1.0 = off.
    """
    c = constants or lc.open_constants(season)
    if values is None:
        if raw is None:
            from . import boxscore_data as bd
            raw = {"batters": bd.batting(season), "pitchers": bd.pitching(season)}
        values = {"batters": pv.batter_value(raw["batters"], c),
                  "pitchers": pv.pitcher_value(raw["pitchers"], c)}
    vals = values
    if "est_salary_won" not in vals["batters"].columns:
        vals["batters"] = salary_model.add_salary(vals["batters"])
    if "est_salary_won" not in vals["pitchers"].columns:
        vals["pitchers"] = salary_model.add_salary(vals["pitchers"])

    franchises = sorted(vals["batters"]["franchise"].unique())
    rows = []
    for f in franchises:
        r = roster.team_roster(season, f, vals, breadth, mode)
        presets = mt.derive_presets(r["pitching"])
        r["pitching"] = mt.apply_bullpen_leverage(r["pitching"], presets["bullpen_leverage"], tactics_weight)
        m = _team_metrics(r["batting"], r["pitching"], c, presets["aggression"], fip_blend)
        m["franchise"] = f
        rows.append(m)
    df = pd.DataFrame(rows).set_index("franchise")

    # Normalize run prevention so the league mean ra == lg_R_per_G, spread from def_rate.
    df["ra"] = df["def_rate"] * c["lg_R_per_G"] / df["def_rate"].mean()
    df["def_index"] = df["ra"] / c["lg_R_per_G"]

    # winning-environment: small modifier from team talent (Σ WAR) + synergy, z-scored
    # across teams. Uses WAR directly — NOT estimated salary — so the sim reflects on-field
    # talent, not a salary proxy. (payroll below is display-only.)
    if wexp_weight > 0:
        env = 1.0 + wexp_weight * 0.5 * (_zscore(df["team_war"]) + _zscore(df["synergy_raw"]))
        df["winning_env"] = env
        df["rs"] = df["rs"] * env
        df["ra"] = df["ra"] / env
    else:
        df["winning_env"] = 1.0

    # Shrink rs/ra toward the league anchor (monotone → ranking-preserving). Corrects the
    # roster pipeline's over-spread; sized on the pooled game-level backtest. off/def_rating
    # below are z-scored, so they're shrink-invariant (only absolute rs/ra move).
    lg = c["lg_R_per_G"]
    df["rs_per_game"] = lg + rating_shrink * (df["rs"] - lg)
    df["ra_per_game"] = lg + rating_shrink * (df["ra"] - lg)
    df["off_rating"] = 100.0 + 15.0 * _zscore(df["off_index"])
    df["def_rating"] = 100.0 + 15.0 * _zscore(-df["def_index"])
    df["pythag_winpct"] = pythag_winpct(df["rs_per_game"], df["ra_per_game"])
    df["proj_wins"] = (df["pythag_winpct"] * config.GAMES_PER_TEAM).round(1)
    df["payroll_ok"] = (df["payroll"] / 1e8).round(0)
    df["ko"] = [data.TEAM_KO[f] for f in df.index]
    df["en"] = [data.TEAM_EN[f] for f in df.index]
    return df.sort_values("proj_wins", ascending=False)


if __name__ == "__main__":
    r = build_team_ratings(2015, mode="actual")
    print("2015 bottom-up team ratings (mode=actual):")
    print(r[["ko", "rs_per_game", "ra_per_game", "off_rating", "def_rating",
             "proj_wins", "payroll_ok", "synergy_raw"]].round(2).to_string())
