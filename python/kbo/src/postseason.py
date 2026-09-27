"""STAGE 2 (part 3) — the KBO postseason stepladder.

Seeded by the regular-season finish (top 5 qualify), the KBO playoff is a
stepladder where the higher seed waits while the lower seeds fight up:

    Wild Card   : seed4 vs seed5 — 2 games, both hosted by seed4, who advances on a
                  single win (seed5 must win BOTH). Winner -> Semi-Playoff.
    Semi-Playoff: seed3 vs WC winner — best-of-5 (2-2-1, seed3 hosts 1,2,5).
    Playoff     : seed2 vs SPO winner — best-of-5 (2-2-1, seed2 hosts 1,2,5).
    Korean Series: seed1 vs PO winner — best-of-7 (2-3-2, seed1 hosts 1,2,6,7).

Adapted from worldcup/src/simulate's knockout logic, but as best-of-N series with the
higher seed's structural edge (waiting + home games) baked into the format. Fully
vectorized over the S simulated seasons: each round plays its games for every sim at
once via game_model, gathering each sim's seeded teams' run rates by index. Games use
no ties (extra innings decide), via game_model.simulate_game_winner.
"""
from __future__ import annotations

import numpy as np

from . import game_model as gm

# Higher-seed home pattern per round ('H' = higher seed hosts that game).
_BO5_PATTERN = ["H", "H", "A", "A", "H"]          # 2-2-1
_BO7_PATTERN = ["H", "H", "A", "A", "A", "H", "H"]  # 2-3-2


def _gather(rates: np.ndarray, idx: np.ndarray) -> np.ndarray:
    """rates[s, idx[s]] for every sim s."""
    return rates[np.arange(rates.shape[0]), idx]


def _game(rng, home_idx, away_idx, rs, ra, lg_rg, k) -> np.ndarray:
    """Boolean [S]: home team beats away team in one game (no ties)."""
    lam_home = gm.expected_runs(_gather(rs, home_idx), _gather(ra, away_idx), lg_rg, home=True)
    lam_away = gm.expected_runs(_gather(rs, away_idx), _gather(ra, home_idx), lg_rg, home=False)
    return gm.simulate_game_winner(rng, lam_home, lam_away, k, allow_tie=False)


def _series(rng, higher, lower, rs, ra, lg_rg, k, n_win: int, pattern) -> np.ndarray:
    """Boolean [S]: the higher seed wins a best-of-(2*n_win-1) series."""
    S = higher.shape[0]
    h_wins = np.zeros(S, dtype=np.int16)
    l_wins = np.zeros(S, dtype=np.int16)
    higher_won = np.zeros(S, dtype=bool)
    decided = np.zeros(S, dtype=bool)
    for slot in pattern:
        if slot == "H":
            hi_wins_game = _game(rng, higher, lower, rs, ra, lg_rg, k)
        else:
            hi_wins_game = ~_game(rng, lower, higher, rs, ra, lg_rg, k)
        live = ~decided
        h_wins += (hi_wins_game & live).astype(np.int16)
        l_wins += (~hi_wins_game & live).astype(np.int16)
        newly = live & ((h_wins == n_win) | (l_wins == n_win))
        higher_won = np.where(newly, h_wins == n_win, higher_won)
        decided |= newly
    return higher_won


def simulate_postseason(rng, seeds: np.ndarray, rs: np.ndarray, ra: np.ndarray,
                        lg_rg: float, k: float = gm.DISPERSION_K):
    """Run the stepladder for all sims.

    seeds : [S,5] team indices, column 0 = regular-season 1st ... column 4 = 5th.
    rs/ra : [S, n_teams] per-sim run rates (already perturbed if rating_sd>0).
    Returns (champion_idx [S], ks_participants [S,2]) as team indices.
    """
    s1, s2, s3, s4, s5 = (seeds[:, c] for c in range(5))

    # Wild Card: seed4 hosts both; advances unless seed5 wins both games.
    g1 = _game(rng, s4, s5, rs, ra, lg_rg, k)
    g2 = _game(rng, s4, s5, rs, ra, lg_rg, k)
    s4_adv = g1 | g2
    wc = np.where(s4_adv, s4, s5)

    # Semi-Playoff (Bo5): seed3 vs WC winner.
    spo = np.where(_series(rng, s3, wc, rs, ra, lg_rg, k, 3, _BO5_PATTERN), s3, wc)
    # Playoff (Bo5): seed2 vs SPO winner.
    po = np.where(_series(rng, s2, spo, rs, ra, lg_rg, k, 3, _BO5_PATTERN), s2, spo)
    # Korean Series (Bo7): seed1 vs PO winner.
    champion = np.where(_series(rng, s1, po, rs, ra, lg_rg, k, 4, _BO7_PATTERN), s1, po)

    ks_participants = np.stack([s1, po], axis=1)
    return champion, ks_participants
