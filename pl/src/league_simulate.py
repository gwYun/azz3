"""STAGE 2 (PL) — Monte-Carlo league simulator (38-game double round-robin).

The World Cup engine simulates a knockout bracket; a domestic league is a
double round-robin instead — 20 clubs, every pair plays twice (home & away) for
380 matches, 3/1/0 points, final table sorted by points then goal difference then
goals for. This module reuses the WC match model verbatim (rating gap -> Poisson
expected goals, with the home side getting the engine's host attack/defence
bonus) and only swaps the tournament structure for a league season.

Fully vectorized over the S simulations: the 380 fixtures are a Python loop, but
each fixture's goals are drawn for all S seasons at once, so total work is
O(#fixtures) array ops regardless of S. Large S runs in chunks to bound memory.
"""
from __future__ import annotations

import numpy as np

from worldcup.src import match_model as mm


class League:
    def __init__(self, ratings: dict[str, float], seed: int = 42, home_adv: bool = True,
                 rating_sd: float = 0.0):
        self.teams = list(ratings.keys())
        self.n = len(self.teams)
        self.r = np.array([ratings[t] for t in self.teams], dtype=float)
        self.seed = int(seed)
        # Home advantage: the home side gets the match model's host attack bonus
        # (and suppresses the away attack). 1.0 = on for the home team each fixture.
        self.home_flag = 1.0 if home_adv else 0.0
        # Pre-season strength uncertainty: pure independent-Poisson match noise
        # under-disperses *season* outcomes (real seasons swing on injuries, form
        # streaks, January business the snapshot can't see), which over-states the
        # favourite's title probability. rating_sd > 0 draws each club's effective
        # rating once per simulated season from Normal(base, rating_sd), a standard
        # league-forecasting correction. Disclosed; not tuned to any club.
        self.rating_sd = float(rating_sd)
        # Every ordered pair (home, away): a double round-robin, 380 fixtures.
        self.fixtures = [(i, j) for i in range(self.n) for j in range(self.n) if i != j]

    def run(self, n_sims: int, chunk: int = 50_000) -> dict:
        """Simulate n_sims full seasons. Returns aggregated probabilities/counts."""
        rng = np.random.default_rng(self.seed)
        title = np.zeros(self.n, dtype=np.int64)
        top4 = np.zeros(self.n, dtype=np.int64)
        top6 = np.zeros(self.n, dtype=np.int64)
        relegated = np.zeros(self.n, dtype=np.int64)  # bottom 3
        pts_sum = np.zeros(self.n, dtype=np.float64)
        pts_sq = np.zeros(self.n, dtype=np.float64)

        done = 0
        while done < n_sims:
            S = min(chunk, n_sims - done)
            order, pts = self._run_chunk(S, rng)  # order[S,n] best->worst, pts[S,n]
            title += np.bincount(order[:, 0], minlength=self.n)
            top4 += np.bincount(order[:, :4].ravel(), minlength=self.n)
            top6 += np.bincount(order[:, :6].ravel(), minlength=self.n)
            relegated += np.bincount(order[:, -3:].ravel(), minlength=self.n)
            pts_sum += pts.sum(axis=0)
            pts_sq += (pts.astype(np.float64) ** 2).sum(axis=0)
            done += S

        mean_pts = pts_sum / n_sims
        std_pts = np.sqrt(np.maximum(pts_sq / n_sims - mean_pts ** 2, 0.0))
        return {
            "teams": self.teams,
            "n_sims": int(n_sims),
            "seed": self.seed,
            "title_prob": {t: title[i] / n_sims for i, t in enumerate(self.teams)},
            "top4_prob": {t: top4[i] / n_sims for i, t in enumerate(self.teams)},
            "top6_prob": {t: top6[i] / n_sims for i, t in enumerate(self.teams)},
            "relegation_prob": {t: relegated[i] / n_sims for i, t in enumerate(self.teams)},
            "mean_points": {t: float(mean_pts[i]) for i, t in enumerate(self.teams)},
            "std_points": {t: float(std_pts[i]) for i, t in enumerate(self.teams)},
        }

    def _run_chunk(self, S: int, rng: np.random.Generator):
        pts = np.zeros((S, self.n), dtype=np.int32)
        gf = np.zeros((S, self.n), dtype=np.int32)
        ga = np.zeros((S, self.n), dtype=np.int32)
        hf = self.home_flag
        if self.rating_sd > 0:
            # One rating draw per simulated season (held fixed across that season's
            # 380 fixtures), so the perturbation models squad-strength uncertainty,
            # not per-match noise (which the Poisson already supplies).
            r_sim = self.r[None, :] + rng.normal(0.0, self.rating_sd, size=(S, self.n))
        else:
            r_sim = np.broadcast_to(self.r[None, :], (S, self.n))
        for i, j in self.fixtures:
            # i hosts j: home side carries the host bonus, away side none.
            lam_i, lam_j = mm.expected_goals(
                r_sim[:, i], r_sim[:, j], hf, 0.0)
            gi, gj = mm.simulate_goals(rng, lam_i, lam_j)
            gf[:, i] += gi; ga[:, i] += gj
            gf[:, j] += gj; ga[:, j] += gi
            iwin = gi > gj; jwin = gj > gi; tie = ~(iwin | jwin)
            pts[:, i] += np.where(iwin, 3, np.where(tie, 1, 0))
            pts[:, j] += np.where(jwin, 3, np.where(tie, 1, 0))
        gd = gf - ga
        jitter = rng.random((S, self.n)) * 0.01  # break exact ties at random
        score = pts * 1e6 + gd * 1e3 + gf * 1e1 + jitter
        order = np.argsort(-score, axis=1)  # [S,n] team indices, best -> worst
        return order, pts
