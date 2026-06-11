"""STAGE 2 (part 1) — PvP match model.

Turns two teams' Stage-1 strength ratings into a match outcome, driven PURELY by
value ratings (user decision: no Elo/odds blend) plus host home advantage.

Method (standard football-forecasting approach):
  1. rating difference -> expected goals for each side via an exponential link,
     calibrated so the strength spread produces realistic international scorelines.
  2. goals ~ independent Poisson (vectorized) for group + knockout matches.
  3. knockout draws after 90' are resolved by extra-time/penalties, weighted slightly
     toward the stronger side (penalties are closer to a coin flip).

All functions are numpy-vectorized: they take arrays of ratings and return arrays of
goals, so a whole simulation round (millions of matches) runs in a few array ops.
"""
from __future__ import annotations

import numpy as np

# Baseline goals an evenly-matched team scores in a neutral international match.
_BASE_GOALS = 1.30
# How strongly a rating gap moves expected goals. Ratings are ~mean 100, sd 15;
# this scale makes a 15-point (1 sd) edge worth ~+0.45 xG, a realistic favorite gap.
_RATING_SCALE = 28.0
# Home-advantage multiplier on a host's attack (and suppression of opponent).
_HOST_ATTACK = 1.12
_HOST_DEFENSE = 0.93
# Penalty-shootout edge for the stronger side (0.5 = coin flip).
_PEN_MAX_EDGE = 0.08


def expected_goals(rating_a: np.ndarray, rating_b: np.ndarray,
                   a_is_host: np.ndarray | float = 0.0,
                   b_is_host: np.ndarray | float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized expected goals (lambda) for sides A and B.

    Each side's attack scales with exp(+/- diff): the stronger side scores more AND
    concedes less. Host status nudges its own xG up and its opponent's down.
    """
    diff = (np.asarray(rating_a, float) - np.asarray(rating_b, float)) / _RATING_SCALE
    lam_a = _BASE_GOALS * np.exp(0.5 * diff)
    lam_b = _BASE_GOALS * np.exp(-0.5 * diff)

    a_host = np.asarray(a_is_host, float)
    b_host = np.asarray(b_is_host, float)
    lam_a = lam_a * (1.0 + (_HOST_ATTACK - 1.0) * a_host) * (1.0 - (1.0 - _HOST_DEFENSE) * b_host)
    lam_b = lam_b * (1.0 + (_HOST_ATTACK - 1.0) * b_host) * (1.0 - (1.0 - _HOST_DEFENSE) * a_host)
    return np.clip(lam_a, 0.05, 6.0), np.clip(lam_b, 0.05, 6.0)


def simulate_goals(rng: np.random.Generator,
                   lam_a: np.ndarray, lam_b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Independent-Poisson goals for both sides (vectorized over a whole round)."""
    return rng.poisson(lam_a), rng.poisson(lam_b)


def knockout_winner(rng: np.random.Generator,
                    rating_a: np.ndarray, rating_b: np.ndarray,
                    a_host=0.0, b_host=0.0) -> np.ndarray:
    """Return boolean mask: True where A wins a single-elimination match.

    90' Poisson; ties broken by a strength-weighted shootout (near coin flip).
    """
    lam_a, lam_b = expected_goals(rating_a, rating_b, a_host, b_host)
    ga, gb = simulate_goals(rng, lam_a, lam_b)
    a_win = ga > gb
    b_win = gb > ga
    tie = ~(a_win | b_win)
    # Shootout edge for the stronger side.
    diff = (np.asarray(rating_a, float) - np.asarray(rating_b, float))
    edge = np.clip(diff / 200.0, -_PEN_MAX_EDGE, _PEN_MAX_EDGE)  # +/- around 0.5
    p_a = 0.5 + edge
    shoot_a = rng.random(len(p_a)) < p_a
    return np.where(tie, shoot_a, a_win)
