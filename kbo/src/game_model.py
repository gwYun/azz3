"""STAGE 2 (part 1) — KBO game run model.

The baseball analog of worldcup/src/match_model: turn two teams' Stage-1 run rates
(rs_per_game / ra_per_game) into a sampled score. Two deliberate departures from the
soccer model, both calibrated to the KBO game log (kbo.src.data.load_game_results):

  * **Expected runs via the log5/Pythagorean run estimate**, not a rating-gap
    exponential: a team's expected runs = its offense rate × the opponent's defense
    rate ÷ league R/G. Evenly-matched teams score the league average; a strong
    offense vs a weak defense scores proportionally more.
  * **Negative Binomial runs, not Poisson.** KBO per-team runs/game have var/mean
    ≈ 2.47 (mean 5.34, var 13.2) — Poisson (var = mean) badly under-disperses, which
    would over-state favorites. NegBinom with dispersion k ≈ 3.6 reproduces the real
    run-distribution spread (var = mean + mean²/k).

Home advantage is a small multiplier on the home side's expected runs, calibrated so
the simulated home win% matches the observed ~0.538.

Everything is numpy-vectorized: arrays of run rates in, arrays of runs out.
"""
from __future__ import annotations

import numpy as np

# Calibrated from load_game_results(2015-2019): per-team runs/game var/mean ≈ 2.47.
DISPERSION_K = 3.64
# Home-side expected-runs multiplier, calibrated so the simulated DECISIVE home win%
# matches the observed ~0.538. (It exceeds the literal +0.14 run home edge because an
# independent-NegBinom score converts a run edge to a win edge less sharply than real
# games do — so the factor is tuned to the win%, the quantity that matters.)
HOME_FACTOR = 1.10
_LAM_CLIP = (0.25, 20.0)


def expected_runs(rs_off: np.ndarray, ra_def_opp: np.ndarray, lg_rg: float,
                  home: bool = False) -> np.ndarray:
    """Expected runs for an offense (rs_off) facing an opponent defense (ra_def_opp).

    log5/Pythagorean form: E[runs] = rs_off * ra_def_opp / lg_rg, optionally boosted
    by the home factor. lg_rg is the league runs-per-team-per-game anchor.
    """
    lam = np.asarray(rs_off, float) * np.asarray(ra_def_opp, float) / lg_rg
    if home:
        lam = lam * HOME_FACTOR
    return np.clip(lam, *_LAM_CLIP)


def expected_runs_pair(rs_home, ra_home, rs_away, ra_away, lg_rg: float,
                       home_adv: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """(lambda_home, lambda_away) for a fixture where the first team is the host."""
    lam_h = expected_runs(rs_home, ra_away, lg_rg, home=home_adv)
    lam_a = expected_runs(rs_away, ra_home, lg_rg, home=False)
    return lam_h, lam_a


def simulate_runs(rng: np.random.Generator, lam: np.ndarray, k: float = DISPERSION_K) -> np.ndarray:
    """Negative-Binomial runs with mean `lam` and dispersion `k` (vectorized).

    Parameterized so mean = lam, var = lam + lam²/k. numpy uses NB(n, p) with
    n = k successes and p = k / (k + lam).
    """
    lam = np.asarray(lam, float)
    p = k / (k + lam)
    return rng.negative_binomial(k, p)


def simulate_game_winner(rng: np.random.Generator, lam_a: np.ndarray, lam_b: np.ndarray,
                         k: float = DISPERSION_K, allow_tie: bool = False) -> np.ndarray:
    """Boolean mask where A beats B in one game.

    Regular season allows ties (the caller handles them); postseason does not, so a
    tied score is resolved by extra innings, modeled as a run-rate-weighted coin flip
    (a near-even tiebreak nudged toward the team expected to score more).
    """
    ra = simulate_runs(rng, lam_a, k)
    rb = simulate_runs(rng, lam_b, k)
    a_win = ra > rb
    if allow_tie:
        return a_win
    tie = ra == rb
    if tie.any():
        p_a = lam_a / (lam_a + lam_b)
        flip = rng.random(len(p_a)) < p_a
        a_win = np.where(tie, flip, a_win)
    return a_win
