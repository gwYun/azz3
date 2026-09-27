"""STAGE 1 (cont.) — Player-combination SYNERGY aggregation.

The transfer-fee model values players individually. Tournaments are won by
*combinations* of players, not by summed individual value. This module turns a
per-player value pool (from squad_strength.py) into one team strength rating,
applying four synergy effects the user explicitly asked for:

  1. Top-end concentration   — weight toward each team's best ~15 players
                               (knockout minutes concentrate on starters), not the
                               full-pool mean.
  2. Spine completeness      — bonus when a team has an elite player in each axis
                               (GK, DF, MF, FW); penalty for lopsided squads.
  3. Positional diminishing  — a 4th elite forward adds less than the 1st; balance
        returns                beats stacking. Concave (sqrt) aggregation per line.
  4. Club chemistry          — small uplift when many of a nation's top players
                               share a club (established understanding).

Output is a synergy MULTIPLIER (~0.9-1.15) applied to the concentrated, concave
base value -> the team's MODEL strength. squad_strength's TM anchor is blended in
later (ratings step inside run_prediction).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# How many players actually carry a tournament squad.
_CORE_N = 15
_LINES = ["GK", "DF", "MF", "FW"]


def _concave_line_value(values: np.ndarray) -> float:
    """Concave aggregation within a position line (diminishing returns).

    Sort descending, weight the k-th best player by 1/sqrt(k+1). The best player
    counts fully; each additional one of the same line adds progressively less.
    """
    v = np.sort(values)[::-1]
    weights = 1.0 / np.sqrt(np.arange(1, len(v) + 1))
    return float(np.sum(v * weights))


def _spine_factor(line_best: dict[str, float], overall_best: float) -> float:
    """Reward a complete spine, penalize lopsided squads.

    Each line's best player is scored as a fraction of the team's single best
    player. A squad strong in every line scores ~1.0 across all four; a squad with
    a hole (e.g. weak GK or no real striker) is dragged down. Returns ~0.85-1.12.
    """
    if overall_best <= 0:
        return 1.0
    frac = np.array([min(line_best.get(ln, 0.0) / overall_best, 1.0) for ln in _LINES])
    # Geometric-mean style: a single near-zero line hurts a lot (the weakest-link idea).
    completeness = float(np.exp(np.mean(np.log(0.15 + 0.85 * frac))))
    # Map completeness in ~[0.3,1.0] to a factor in ~[0.85,1.12].
    return 0.85 + 0.27 * completeness


def _chemistry_factor(clubs: pd.Series) -> float:
    """Uplift when a nation's core players cluster at few clubs.

    HHI-style concentration of the core players' clubs. A spine drawn from 2-3 elite
    clubs (e.g. several starters at the same club) gets a small bonus for established
    on-pitch chemistry. Returns ~1.00-1.05.
    """
    if len(clubs) == 0:
        return 1.0
    shares = clubs.value_counts(normalize=True).to_numpy()
    hhi = float(np.sum(shares ** 2))  # 1/n_distinct .. 1.0
    # hhi for fully-spread core ~ small; for concentrated ~ larger. Scale to [1.0,1.05].
    return 1.0 + 0.05 * min(max((hhi - 0.1) / 0.4, 0.0), 1.0)


def team_strength(pool: pd.DataFrame, value_col: str = "model_val") -> dict:
    """Aggregate a single team's player pool into a synergy-adjusted strength.

    `pool` is the rows of ONE team (columns: value_col, pos_bucket, club).
    Returns a dict with the final `strength` plus the components, for explainability.
    """
    p = pool.sort_values(value_col, ascending=False).head(_CORE_N).copy()
    if len(p) == 0:
        return {"strength": 0.0, "base": 0.0, "spine": 1.0, "chemistry": 1.0,
                "n_core": 0, "top_player_val": 0.0}

    # Base: concave aggregation within each line, then summed across lines.
    base = 0.0
    line_best: dict[str, float] = {}
    for ln in _LINES:
        vals = p.loc[p["pos_bucket"] == ln, value_col].to_numpy()
        if len(vals):
            base += _concave_line_value(vals)
            line_best[ln] = float(vals.max())
        else:
            line_best[ln] = 0.0

    overall_best = float(p[value_col].max())
    spine = _spine_factor(line_best, overall_best)
    chem = _chemistry_factor(p["club"])

    strength = base * spine * chem
    return {
        "strength": strength,
        "base": base,
        "spine": round(spine, 4),
        "chemistry": round(chem, 4),
        "synergy_mult": round(spine * chem, 4),
        "n_core": int(len(p)),
        "top_player_val": overall_best,
    }


def all_team_strengths(pool: pd.DataFrame, teams: list[str],
                       value_col: str = "model_val") -> pd.DataFrame:
    """Compute synergy-adjusted MODEL strength for each WC team.

    Teams with no Euro-based players in the pool get strength 0 here; the TM anchor
    (blended later) carries them.
    """
    rows = []
    for t in teams:
        sub = pool[pool["team"] == t]
        comp = team_strength(sub, value_col=value_col)
        comp["team"] = t
        rows.append(comp)
    out = pd.DataFrame(rows).set_index("team")
    return out
