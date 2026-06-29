"""KBO league constants, re-derived from each season's league totals.

MLB constants are wrong for the KBO: it is a higher run environment (~4.6-5.4 R/G
vs MLB's ~4.5), so the wOBA scale, the FIP constant, the runs-per-win factor and the
league baselines are all computed HERE from the KBO team-season totals — never
hard-coded from MLB. The only borrowed numbers are the wOBA *event weights*: those
are the standard near-invariant marginal run values (they barely move across run
environments), and everything that scales them to runs and wins is KBO-derived.

A Phase-2 invariant the validation checks: league-average FIP reconstructed with the
computed FIP constant equals league ERA, and league wRC+ ≈ 100. If either fails, an
MLB constant has leaked in.
"""
from __future__ import annotations

import json

from . import config
from . import data

# Standard wOBA event weights (marginal run value of each event). lgwOBA + wOBAScale
# below re-anchor these to each KBO season, which is what makes wRAA/wRC+ KBO-correct.
WOBA_WEIGHTS = {"BB": 0.69, "HBP": 0.72, "1B": 0.88, "2B": 1.24, "3B": 1.56, "HR": 2.08}

# Batter replacement level: a replacement-level player is ~20 runs below average per
# 600 PA, the value that puts a league of replacement players near a .294 win%.
REPLACEMENT_RUNS_PER_600PA = 20.0
# Replacement-level pitcher FIP = league FIP * this (replacement pitchers allow ~10% more).
REPLACEMENT_FIP_FACTOR = 1.10
# MLB anchor for runs-per-win (~10 runs/win at ~4.5 R/G); scales up in higher
# run environments, so KBO's ~5 R/G gives a slightly larger RPW.
_RPW_ANCHOR_RPW = 10.0
_RPW_ANCHOR_RPG = 4.5

_CACHE = config.INTERIM_DIR / "league_constants.json"


def _sum(df, col):
    return float(df[col].sum())


def compute_constants(season: int, use_cache: bool = True) -> dict:
    """All KBO-derived constants for one season (from team-season totals)."""
    tb = data.team_batting(season, use_cache=use_cache)
    tp = data.team_pitching(season, use_cache=use_cache)

    # --- batting league totals ---
    PA, AB, H = _sum(tb, "PA"), _sum(tb, "AB"), _sum(tb, "H")
    B1, B2, B3, HR = _sum(tb, "B1"), _sum(tb, "B2"), _sum(tb, "B3"), _sum(tb, "HR")
    BB, IBB, HBP, SF = _sum(tb, "BB"), _sum(tb, "IBB"), _sum(tb, "HBP"), _sum(tb, "SF")
    R = _sum(tb, "R")
    team_games = _sum(tb, "G")          # sum of each team's games (= 2 * total games)

    w = WOBA_WEIGHTS
    uBB = BB - IBB
    woba_num = (w["BB"] * uBB + w["HBP"] * HBP + w["1B"] * B1
                + w["2B"] * B2 + w["3B"] * B3 + w["HR"] * HR)
    woba_den = AB + BB - IBB + SF + HBP
    lg_wOBA = woba_num / woba_den
    lg_OBP = (H + BB + HBP) / (AB + BB + HBP + SF)
    wOBA_scale = lg_OBP / lg_wOBA
    lg_R_per_PA = R / PA
    lg_R_per_G = R / team_games          # runs per team per game (~4.6-5.4 in KBO)

    # --- pitching league totals (for FIP constant) ---
    IP, ER = _sum(tp, "IP"), _sum(tp, "ER")
    HR_p, BB_p, HBP_p, SO_p = _sum(tp, "HR"), _sum(tp, "BB"), _sum(tp, "HBP"), _sum(tp, "SO")
    lg_ERA = ER * 9.0 / IP
    fip_kernel = (13 * HR_p + 3 * (BB_p + HBP_p) - 2 * SO_p) / IP
    FIP_const = lg_ERA - fip_kernel      # so league-average FIP == league ERA
    lg_FIP = lg_ERA

    RPW = _RPW_ANCHOR_RPW * lg_R_per_G / _RPW_ANCHOR_RPG

    return {
        "season": season,
        "lg_wOBA": round(lg_wOBA, 5),
        "wOBA_scale": round(wOBA_scale, 5),
        "lg_OBP": round(lg_OBP, 5),
        "lg_R_per_PA": round(lg_R_per_PA, 5),
        "lg_R_per_G": round(lg_R_per_G, 4),
        "lg_ERA": round(lg_ERA, 4),
        "lg_FIP": round(lg_FIP, 4),
        "FIP_const": round(FIP_const, 4),
        "RPW": round(RPW, 3),
        "replacement_runs_per_600pa": REPLACEMENT_RUNS_PER_600PA,
        "replacement_fip_factor": REPLACEMENT_FIP_FACTOR,
        # Park factors are NEUTRAL in v1: current-park factors need recent game-level
        # data, and the open game log stops at 2019 (with several parks since rebuilt),
        # so applying stale factors would bias more than help. Disclosed limitation.
        "park_factor_neutral": True,
    }


def constants(seasons: list[int], use_cache: bool = True) -> dict[int, dict]:
    """Constants for several seasons, cached to one JSON keyed by season."""
    cached: dict[str, dict] = {}
    if use_cache and _CACHE.exists():
        cached = json.loads(_CACHE.read_text())
    out = {}
    dirty = False
    for s in seasons:
        if use_cache and str(s) in cached:
            out[s] = cached[str(s)]
        else:
            out[s] = compute_constants(s, use_cache=use_cache)
            cached[str(s)] = out[s]
            dirty = True
    if dirty:
        _CACHE.write_text(json.dumps(cached, ensure_ascii=False, indent=2))
    return out


if __name__ == "__main__":
    import pandas as pd
    rows = [compute_constants(s) for s in (2023, 2024, 2025)]
    print(pd.DataFrame(rows).to_string(index=False))
