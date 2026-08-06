"""Recalibrate the KBO game engine on the POOLED real game log (2015-2019 historical
+ 2026 live from Naver) and pick a rating-shrinkage that fixes the overconfident
favorites found in the 2026 validation — WITHOUT overfitting to 2026.

Discipline:
  * HOME_FACTOR / DISPERSION_K are empirical constants → recalibrated on the pooled
    decisive-home-win% and per-team run var/mean (2026 alone is too small / noisy).
  * rating_shrink (new) is chosen by game-level log-loss TRAINED on 2015-2019 and only
    CONFIRMED on 2026 (out-of-sample), so 2026 doesn't drive the choice.

Prints train (2015-2019) vs test (2026) Brier/LogLoss/Acc for a shrink sweep, plus the
recalibrated HOME_FACTOR / DISPERSION_K, and (optionally) the season-standings ρ guard.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.stats import nbinom

from kbo.src import config, data, league_constants as lc, team_build as tbuild

_SIM_PARAMS = dict(breadth=6.0, mode="actual", wexp_weight=0.04, tactics_weight=1.0, fip_blend=0.25)
_NAVER_2026 = config.RAW_DIR / "kbo_games" / "naver_KBO_2026_played.csv"


# --------------------------------------------------------------------------- #
# Pooled game log.                                                             #
# --------------------------------------------------------------------------- #
def naver_2026_log() -> pd.DataFrame:
    df = pd.read_csv(_NAVER_2026)
    df = df[df["cancel"] == False]
    return df[["season", "home_franchise", "away_franchise", "home_score", "away_score"]].copy()


def historical_log() -> pd.DataFrame:
    g = data.load_game_results(seasons=config.BACKTEST_SEASONS, regular_only=True)
    return g[["season", "home_franchise", "away_franchise", "home_score", "away_score"]].copy()


# --------------------------------------------------------------------------- #
# Empirical constants.                                                        #
# --------------------------------------------------------------------------- #
def empirical_home_win(log: pd.DataFrame) -> tuple[float, int]:
    dec = log[log["home_score"] != log["away_score"]]
    hw = (dec["home_score"] > dec["away_score"]).mean()
    return float(hw), len(dec)


def empirical_k(log: pd.DataFrame) -> tuple[float, float, float]:
    """Dispersion k from per-team-game runs: var = mean + mean^2/k  ->  k = mean^2/(var-mean)."""
    runs = np.concatenate([log["home_score"].to_numpy(), log["away_score"].to_numpy()])
    m, v = float(runs.mean()), float(runs.var())
    k = m * m / (v - m) if v > m else np.inf
    return k, m, v


# --------------------------------------------------------------------------- #
# Game-level prediction (independent NegBinom scores).                        #
# --------------------------------------------------------------------------- #
_GRID = np.arange(41)


def _p_home(lam_h, lam_a, k) -> float:
    ph = nbinom.pmf(_GRID, k, k / (k + lam_h))
    pa = nbinom.pmf(_GRID, k, k / (k + lam_a))
    M = np.outer(ph, pa)
    p_h, p_a = np.tril(M, -1).sum(), np.triu(M, 1).sum()
    return p_h / (p_h + p_a)


def shrink_rates(rs: dict, ra: dict, lg: float, s: float) -> tuple[dict, dict]:
    """Linear pull of each team's rs/ra toward the league anchor (s=1 → unchanged)."""
    return ({t: lg + s * (v - lg) for t, v in rs.items()},
            {t: lg + s * (v - lg) for t, v in ra.items()})


def predict_log(log: pd.DataFrame, rs: dict, ra: dict, lg: float, H: float, k: float):
    """(p_home, home_won) over decisive games in `log` for one season's ratings."""
    dec = log[log["home_score"] != log["away_score"]]
    ph, won = [], []
    for _, g in dec.iterrows():
        h, a = g["home_franchise"], g["away_franchise"]
        if h not in rs or a not in rs:
            continue
        lam_h = rs[h] * ra[a] / lg * H
        lam_a = rs[a] * ra[h] / lg
        ph.append(_p_home(lam_h, lam_a, k))
        won.append(1 if g["home_score"] > g["away_score"] else 0)
    return np.array(ph), np.array(won)


def metrics(ph: np.ndarray, won: np.ndarray) -> dict:
    p = np.clip(ph, 1e-6, 1 - 1e-6)
    return {"n": len(won), "brier": float(((ph - won) ** 2).mean()),
            "logloss": float(-(won * np.log(p) + (1 - won) * np.log(1 - p)).mean()),
            "acc": float(((ph > 0.5) == won).mean())}


# --------------------------------------------------------------------------- #
# Ratings sources.                                                            #
# --------------------------------------------------------------------------- #
def historical_ratings(season: int) -> tuple[dict, dict, float]:
    c = lc.open_constants(season)
    r = tbuild.build_team_ratings(season, constants=c, **_SIM_PARAMS)
    return r["rs_per_game"].to_dict(), r["ra_per_game"].to_dict(), c["lg_R_per_G"]


def ratings_2026() -> tuple[dict, dict, float]:
    mj = json.load(open(config.OUTPUTS_DIR / "kbo-matchup.json"))
    rs = {t["code"]: t["rs_per_game"] for t in mj["teams"]}
    ra = {t["code"]: t["ra_per_game"] for t in mj["teams"]}
    return rs, ra, mj["league"]["lg_R_per_G"]


def main():
    hist = historical_log()
    nav = naver_2026_log()
    pooled = pd.concat([hist, nav], ignore_index=True)

    print("=" * 72)
    print("POOLED GAME LOG")
    print(f"  historical 2015-2019: {len(hist)} games   |   naver 2026: {len(nav)} games")
    hw_h, n_h = empirical_home_win(hist)
    hw_n, n_n = empirical_home_win(nav)
    hw_p, n_p = empirical_home_win(pooled)
    print(f"  decisive home-win%:  2015-19 {hw_h:.3f} (n={n_h})   2026 {hw_n:.3f} (n={n_n})   "
          f"pooled {hw_p:.3f} (n={n_p})")
    k_p, m_p, v_p = empirical_k(pooled)
    k_h, _, _ = empirical_k(hist)
    k_n, _, _ = empirical_k(nav)
    print(f"  run var/mean:        pooled mean {m_p:.2f} var {v_p:.2f} -> k {k_p:.2f}   "
          f"(2015-19 k {k_h:.2f}, 2026 k {k_n:.2f})")

    # Cache ratings once per source (shrink is applied linearly afterwards).
    print("\n  building 2015-2019 roster ratings (from open dump) ...")
    hist_rat = {s: historical_ratings(s) for s in config.BACKTEST_SEASONS}
    rs26, ra26, lg26 = ratings_2026()

    # Recalibrated constants used for the sweep (pooled).
    K = round(k_p, 2)
    # Solve HOME_FACTOR so mean predicted home-win over the pooled schedule == observed.
    def mean_pred_home(H, shrink):
        phs = []
        for s, (rs, ra, lg) in hist_rat.items():
            rs2, ra2 = shrink_rates(rs, ra, lg, shrink)
            ph, _ = predict_log(hist[hist["season"] == s], rs2, ra2, lg, H, K)
            phs.append(ph)
        rs2, ra2 = shrink_rates(rs26, ra26, lg26, shrink)
        ph, _ = predict_log(nav, rs2, ra2, lg26, H, K)
        phs.append(ph)
        return np.concatenate(phs).mean()

    print("\n" + "=" * 72)
    print("SHRINK SWEEP  (train = 2015-2019, test = 2026, out-of-sample)")
    print(f"{'shrink':>6} | {'train brier':>11} {'train ll':>9} {'train acc':>9} | "
          f"{'test brier':>10} {'test ll':>8} {'test acc':>8}")
    H_FIXED = 1.10
    best = None
    for s in [1.0, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5]:
        tr_ph, tr_won = [], []
        for season, (rs, ra, lg) in hist_rat.items():
            rs2, ra2 = shrink_rates(rs, ra, lg, s)
            ph, won = predict_log(hist[hist["season"] == season], rs2, ra2, lg, H_FIXED, K)
            tr_ph.append(ph); tr_won.append(won)
        tr = metrics(np.concatenate(tr_ph), np.concatenate(tr_won))
        rs2, ra2 = shrink_rates(rs26, ra26, lg26, s)
        te = metrics(*predict_log(nav, rs2, ra2, lg26, H_FIXED, K))
        print(f"{s:>6.2f} | {tr['brier']:>11.4f} {tr['logloss']:>9.4f} {tr['acc']:>9.3f} | "
              f"{te['brier']:>10.4f} {te['logloss']:>8.4f} {te['acc']:>8.3f}")
        if best is None or tr["logloss"] < best[1]:
            best = (s, tr["logloss"])

    s_best = best[0]
    # Recalibrate H at the chosen shrink to hit the pooled observed home-win%.
    lo, hi = 1.0, 1.25
    for _ in range(40):
        mid = (lo + hi) / 2
        if mean_pred_home(mid, s_best) < hw_p:
            lo = mid
        else:
            hi = mid
    H_best = round((lo + hi) / 2, 3)

    print("\n" + "=" * 72)
    print("RECOMMENDED (pooled-calibrated, shrink chosen on 2015-2019 train):")
    print(f"  DISPERSION_K : 3.64  -> {K}")
    print(f"  HOME_FACTOR  : 1.10  -> {H_best}   (targets pooled home-win {hw_p:.3f})")
    print(f"  rating_shrink: 1.00  -> {s_best}   (best 2015-2019 log-loss)")


if __name__ == "__main__":
    main()
