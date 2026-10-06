"""STAGE 3 — match model: value-driven Poisson with result-based residuals.

    log λ_home = μ + h + att_H − def_A          att_i = β_a · r_i + u_i
    log λ_away = μ     + att_A − def_H          def_i = β_d · r_i + v_i

r_i is the club's pre-season VALUE rating (club_value.club_ratings) for the
season the game belongs to. Three variants share this one likelihood:

  value   — u = v = 0. Goals are driven purely by value; μ, h, β_a, β_d are
            FITTED on past results (replacing the hand-set _RATING_SCALE /
            _HOST_ATTACK of soccer.engine.match_model).
  results — β = 0. Classic Dixon-Coles team strengths learned from results only.
  hybrid  — both: value sets the prior, u / v are ridge-shrunk toward 0 so a
            team's strength starts at its value and drifts with results.

Observations are time-decayed (w = exp(−ξ·days ago)). Low scores get the
Dixon-Coles τ correction with ρ fitted by 1-D grid after the Poisson fit.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import poisson

MAX_GOALS = 10
_RHO_GRID = np.linspace(-0.25, 0.15, 41)


@dataclass
class Fit:
    kind: str
    teams: list
    mu: float
    home: float
    beta_a: float
    beta_d: float
    u: np.ndarray
    v: np.ndarray
    rho: float

    def lambdas(self, home: np.ndarray, away: np.ndarray,
                r_home: np.ndarray, r_away: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        idx = {t: i for i, t in enumerate(self.teams)}
        ih = np.array([idx.get(t, -1) for t in home])
        ia = np.array([idx.get(t, -1) for t in away])
        # Unseen team (e.g. promoted, results model) → residual 0 = league average.
        uh = np.where(ih >= 0, self.u[np.maximum(ih, 0)], 0.0)
        ua = np.where(ia >= 0, self.u[np.maximum(ia, 0)], 0.0)
        vh = np.where(ih >= 0, self.v[np.maximum(ih, 0)], 0.0)
        va = np.where(ia >= 0, self.v[np.maximum(ia, 0)], 0.0)
        att_h, att_a = self.beta_a * r_home + uh, self.beta_a * r_away + ua
        def_h, def_a = self.beta_d * r_home + vh, self.beta_d * r_away + va
        lh = np.exp(self.mu + self.home + att_h - def_a)
        la = np.exp(self.mu + att_a - def_h)
        return lh, la


def _tau(x, y, lh, la, rho):
    t = np.ones_like(lh)
    t = np.where((x == 0) & (y == 0), 1 - lh * la * rho, t)
    t = np.where((x == 0) & (y == 1), 1 + lh * rho, t)
    t = np.where((x == 1) & (y == 0), 1 + la * rho, t)
    t = np.where((x == 1) & (y == 1), 1 - rho, t)
    return t


def fit(games: pd.DataFrame, kind: str, xi: float, pen: float, asof: pd.Timestamp) -> Fit:
    """Fit on `games` (finished, all before `asof`).

    games needs home_team, away_team, home_score, away_score, game_date,
    r_home, r_away. `pen` is the ridge on the residuals u, v (hybrid / results).
    """
    teams = sorted(set(games["home_team"]) | set(games["away_team"]))
    idx = {t: i for i, t in enumerate(teams)}
    T = len(teams)
    ih = games["home_team"].map(idx).to_numpy()
    ia = games["away_team"].map(idx).to_numpy()
    yh = games["home_score"].to_numpy(float)
    ya = games["away_score"].to_numpy(float)
    rh = games["r_home"].to_numpy(float)
    ra = games["r_away"].to_numpy(float)
    days = (asof - games["game_date"]).dt.days.to_numpy(float)
    w = np.exp(-xi * days)

    use_beta = kind in ("value", "hybrid")
    use_res = kind in ("results", "hybrid")

    def unpack(th):
        mu, h = th[0], th[1]
        k = 2
        ba = bd = 0.0
        if use_beta:
            ba, bd = th[2], th[3]
            k = 4
        u = th[k:k + T] if use_res else np.zeros(T)
        v = th[k + T:k + 2 * T] if use_res else np.zeros(T)
        return mu, h, ba, bd, u, v

    def nll(th):
        mu, h, ba, bd, u, v = unpack(th)
        lh = np.exp(mu + h + ba * rh + u[ih] - bd * ra - v[ia])
        la = np.exp(mu + ba * ra + u[ia] - bd * rh - v[ih])
        f = np.sum(w * (lh - yh * np.log(lh) + la - ya * np.log(la)))
        gh, ga = w * (lh - yh), w * (la - ya)
        grad = [np.sum(gh + ga), np.sum(gh)]
        if use_beta:
            grad += [np.sum(gh * rh + ga * ra), np.sum(-gh * ra - ga * rh)]
        if use_res:
            gu = np.bincount(ih, gh, T) + np.bincount(ia, ga, T)
            gv = -np.bincount(ia, gh, T) - np.bincount(ih, ga, T)
            f += pen * (np.sum(u ** 2) + np.sum(v ** 2))
            grad = np.concatenate([grad, gu + 2 * pen * u, gv + 2 * pen * v])
        return f, np.asarray(grad, float)

    n = 2 + (2 if use_beta else 0) + (2 * T if use_res else 0)
    th0 = np.zeros(n)
    th0[0] = np.log(max(np.average((yh + ya) / 2, weights=w), 0.1))
    res = minimize(nll, th0, jac=True, method="L-BFGS-B")
    mu, h, ba, bd, u, v = unpack(res.x)

    # Dixon-Coles ρ by grid on the fitted λ (weighted log-likelihood of τ only).
    lh = np.exp(mu + h + ba * rh + u[ih] - bd * ra - v[ia])
    la = np.exp(mu + ba * ra + u[ia] - bd * rh - v[ih])
    low = (yh <= 1) & (ya <= 1)
    best, rho = -np.inf, 0.0
    for r in _RHO_GRID:
        t = _tau(yh[low], ya[low], lh[low], la[low], r)
        if np.any(t <= 0):
            continue
        ll = np.sum(w[low] * np.log(t))
        if ll > best:
            best, rho = ll, r
    return Fit(kind, teams, mu, h, ba, bd, np.array(u), np.array(v), float(rho))


def outcome_probs(lh: np.ndarray, la: np.ndarray, rho: float) -> np.ndarray:
    """(n, 3) array of P(home win), P(draw), P(away win) with the DC τ."""
    g = np.arange(MAX_GOALS + 1)
    ph = poisson.pmf(g[None, :], lh[:, None])            # (n, G)
    pa = poisson.pmf(g[None, :], la[:, None])
    m = ph[:, :, None] * pa[:, None, :]                  # (n, G, G) home x away
    m[:, 0, 0] *= 1 - lh * la * rho
    m[:, 0, 1] *= 1 + lh * rho
    m[:, 1, 0] *= 1 + la * rho
    m[:, 1, 1] *= 1 - rho
    m /= m.sum(axis=(1, 2), keepdims=True)
    hw = np.tril(np.ones((MAX_GOALS + 1,) * 2), -1)      # home > away
    return np.stack([(m * hw).sum((1, 2)),
                     np.trace(m, axis1=1, axis2=2),
                     (m * hw.T).sum((1, 2))], axis=1)
