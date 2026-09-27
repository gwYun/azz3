"""STAGE 2 (part 2) — Monte-Carlo of the 144-game KBO regular season.

The baseball sibling of pl/src/league_simulate.League. Differences from the soccer
double round-robin:
  * **Unbalanced schedule:** 10 teams, each ordered pair plays 8 home games -> 16 per
    opponent pair -> 144 games/team, 720 total (vs the PL's 380).
  * **Runs, not goals:** each game's score is NegBinom (game_model), and a tied score
    is a TIE (KBO games can end level after extra innings) — excluded from win%.
  * **Standings by win%, then run differential** (KBO rule), replacing the PL's
    points / goal-difference key.

Kept verbatim from the PL engine: the chunked, fully-vectorized structure (all S
simulated seasons drawn at once per fixture, large S run in memory-bounded chunks)
and the `rating_sd` season-strength perturbation that fixes the independent-noise
under-dispersion of season outcomes — here a per-season multiplicative wobble on each
team's run rates. A postseason callback runs on each chunk's standings so the
postseason never needs the full [S, 10] order array materialized at once.
"""
from __future__ import annotations

import numpy as np

from . import config
from . import game_model as gm

_GAMES_PER_PAIR_HOME = config.GAMES_VS_EACH_OPPONENT // 2   # 8 home games per ordered pair


class Season:
    def __init__(self, rs: dict[str, float], ra: dict[str, float], lg_rg: float,
                 seed: int = 42, home_adv: bool = True, rating_sd: float = 0.0,
                 k: float = gm.DISPERSION_K):
        self.teams = list(rs.keys())
        self.n = len(self.teams)
        self.rs = np.array([rs[t] for t in self.teams], dtype=float)
        self.ra = np.array([ra[t] for t in self.teams], dtype=float)
        self.lg_rg = float(lg_rg)
        self.seed = int(seed)
        self.home_adv = home_adv
        self.rating_sd = float(rating_sd)
        self.k = float(k)
        # Every ordered pair (home, away): 90 pairs, each played _GAMES_PER_PAIR_HOME times.
        self.pairs = [(i, j) for i in range(self.n) for j in range(self.n) if i != j]

    def run(self, n_sims: int, chunk: int = 50_000, postseason_fn=None) -> dict:
        rng = np.random.default_rng(self.seed)
        rank_counts = np.zeros((self.n, self.n), dtype=np.int64)  # [team, finish_rank]
        playoff = np.zeros(self.n, dtype=np.int64)                # top 5
        first = np.zeros(self.n, dtype=np.int64)                  # regular-season 1st
        wins_sum = np.zeros(self.n); wins_sq = np.zeros(self.n)
        champ = np.zeros(self.n, dtype=np.int64)                  # Korean Series winner
        pennant = np.zeros(self.n, dtype=np.int64)                # reached Korean Series

        done = 0
        while done < n_sims:
            S = min(chunk, n_sims - done)
            order, wins, sim_rs, sim_ra = self._run_chunk(S, rng)
            for r in range(self.n):
                rank_counts[:, r] += np.bincount(order[:, r], minlength=self.n)
            playoff += np.bincount(order[:, :5].ravel(), minlength=self.n)
            first += np.bincount(order[:, 0], minlength=self.n)
            wins_sum += wins.sum(axis=0)
            wins_sq += (wins.astype(np.float64) ** 2).sum(axis=0)
            if postseason_fn is not None:
                seeds = order[:, :5]                # [S,5] best->5th
                champ_idx, pennant_mask = postseason_fn(rng, seeds, sim_rs, sim_ra)
                champ += np.bincount(champ_idx, minlength=self.n)
                pennant += np.bincount(pennant_mask.ravel(), minlength=self.n)
            done += S

        mean_w = wins_sum / n_sims
        std_w = np.sqrt(np.maximum(wins_sq / n_sims - mean_w ** 2, 0.0))
        idx = {t: i for i, t in enumerate(self.teams)}
        f = lambda arr: {t: arr[idx[t]] / n_sims for t in self.teams}
        return {
            "teams": self.teams, "n_sims": int(n_sims), "seed": self.seed,
            "first_prob": f(first),
            "playoff_prob": f(playoff),
            "champion_prob": f(champ) if postseason_fn else None,
            "pennant_prob": f(pennant) if postseason_fn else None,
            "mean_wins": {t: float(mean_w[idx[t]]) for t in self.teams},
            "std_wins": {t: float(std_w[idx[t]]) for t in self.teams},
            "rank_prob": {t: (rank_counts[idx[t]] / n_sims) for t in self.teams},
        }

    def _perturb(self, S: int, rng: np.random.Generator):
        if self.rating_sd <= 0:
            rs = np.broadcast_to(self.rs[None, :], (S, self.n)).copy()
            ra = np.broadcast_to(self.ra[None, :], (S, self.n)).copy()
            return rs, ra
        # One multiplicative wobble per team per simulated season (held across its 144
        # games) -> models season-strength uncertainty, not per-game noise.
        rs = self.rs[None, :] * np.exp(rng.normal(0.0, self.rating_sd, (S, self.n)))
        ra = self.ra[None, :] * np.exp(rng.normal(0.0, self.rating_sd, (S, self.n)))
        return rs, ra

    def _run_chunk(self, S: int, rng: np.random.Generator):
        rs, ra = self._perturb(S, rng)
        W = np.zeros((S, self.n), dtype=np.int32)
        L = np.zeros((S, self.n), dtype=np.int32)
        rd = np.zeros((S, self.n), dtype=np.int64)   # run differential
        g = _GAMES_PER_PAIR_HOME
        ha = self.home_adv
        for i, j in self.pairs:
            lam_h = gm.expected_runs(rs[:, i], ra[:, j], self.lg_rg, home=ha)  # [S]
            lam_a = gm.expected_runs(rs[:, j], ra[:, i], self.lg_rg, home=False)
            # 8 home games for i vs j, drawn for all S seasons at once: shape [S, g]
            rh = gm.simulate_runs(rng, np.repeat(lam_h[:, None], g, axis=1), self.k)
            raj = gm.simulate_runs(rng, np.repeat(lam_a[:, None], g, axis=1), self.k)
            home_win = rh > raj
            tie = rh == raj
            # Extra innings: KBO regulation ties (~9% of 9-inning finals) are almost
            # all resolved in extra frames (real tie rate ~1%), so resolve them with a
            # run-rate-weighted coin flip rather than leaving them as ties.
            if tie.any():
                p_home = (lam_h / (lam_h + lam_a))[:, None]
                flip_home = rng.random(rh.shape) < p_home
                home_win = np.where(tie, flip_home, home_win)
            hw = home_win.sum(axis=1); aw = g - hw
            W[:, i] += hw; L[:, i] += aw
            W[:, j] += aw; L[:, j] += hw
            diff = (rh - raj).sum(axis=1)
            rd[:, i] += diff; rd[:, j] -= diff

        decisions = (W + L)
        win_pct = np.where(decisions > 0, W / np.maximum(decisions, 1), 0.0)
        jitter = rng.random((S, self.n)) * 1e-4
        score = win_pct * 1e6 + rd * 1e-1 + jitter
        order = np.argsort(-score, axis=1)           # [S,n] best -> worst
        return order, W, rs, ra
