"""Walk-forward backtest of the value / results / hybrid match models.

Protocol (no look-ahead):
  * Every week (cutoff = each Monday) and per league, refit on all finished
    league games BEFORE the cutoff (2023/24 onward, time-decayed) and predict the
    games kicking off in [cutoff, cutoff + 7d).
  * Each game's value rating is its club's PRE-SEASON rating for that season.
  * Hyper-parameters (ξ decay, ridge pen) are chosen on 2024/25 ONLY; 2025/26
    and 2026/27-to-date are the untouched holdout.

Metrics: RPS (ranked probability score, the standard for ordered 1X2), log
loss, Brier; plus a base-rate baseline (training H/D/A frequencies) and a
calibration table for the favourite's probability.

Usage (from python/):
  ../.venv/bin/python -m soccer.apps.league_predict.backtest
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .club_value import club_ratings
from .data import BIG5, load_games, load_players
from .match_model import fit, outcome_probs

_OUT = Path(__file__).resolve().parent
TUNE_SEASON = 2024
TEST_SEASONS = [2025, 2026]
GRID = {
    "value":   {"xi": [0.001, 0.002, 0.004], "pen": [0.0]},
    "results": {"xi": [0.001, 0.002, 0.004], "pen": [0.5, 2.0, 8.0]},
    "hybrid":  {"xi": [0.001, 0.002, 0.004], "pen": [2.0, 8.0, 32.0]},
}


def _with_ratings(games: pd.DataFrame, ratings: pd.DataFrame) -> pd.DataFrame:
    r = ratings.set_index(["league", "season", "team"])["rating"]
    g = games.copy()
    g["r_home"] = [r.get((l, s, t), 0.0) for l, s, t in zip(g.league, g.season, g.home_team)]
    g["r_away"] = [r.get((l, s, t), 0.0) for l, s, t in zip(g.league, g.season, g.away_team)]
    return g


def walk_forward(games: pd.DataFrame, kind: str, xi: float, pen: float,
                 seasons: list[int]) -> pd.DataFrame:
    """Predictions for every finished game of `seasons` (weekly refits)."""
    done = games[games["status"] == "RESULT"]
    out = []
    for lg in BIG5:
        gl = done[done["league"] == lg]
        test = gl[gl["season"].isin(seasons)]
        if test.empty:
            continue
        start = test["game_date"].min().normalize()
        cut = start - pd.Timedelta(days=start.weekday())     # Monday on/before
        while cut <= test["game_date"].max():
            nxt = cut + pd.Timedelta(days=7)
            wk = test[(test["game_date"] >= cut) & (test["game_date"] < nxt)]
            if len(wk):
                train = gl[gl["game_date"] < cut]
                f = fit(train, kind, xi, pen, cut)
                lh, la = f.lambdas(wk.home_team.to_numpy(), wk.away_team.to_numpy(),
                                   wk.r_home.to_numpy(), wk.r_away.to_numpy())
                p = outcome_probs(lh, la, f.rho)
                base = np.array([(train.home_score > train.away_score).mean(),
                                 (train.home_score == train.away_score).mean(),
                                 (train.home_score < train.away_score).mean()])
                out.append(pd.DataFrame({
                    "game_id": wk.game_id.values, "league": lg, "season": wk.season.values,
                    "game_date": wk.game_date.values,
                    "home": wk.home_name.values, "away": wk.away_name.values,
                    "hs": wk.home_score.values, "as": wk.away_score.values,
                    "lh": lh, "la": la, "pH": p[:, 0], "pD": p[:, 1], "pA": p[:, 2],
                    "bH": base[0], "bD": base[1], "bA": base[2],
                    "home_adv": f.home, "beta_a": f.beta_a, "beta_d": f.beta_d, "rho": f.rho,
                }))
            cut = nxt
    return pd.concat(out, ignore_index=True)


def metrics(df: pd.DataFrame, cols=("pH", "pD", "pA")) -> dict:
    p = df[list(cols)].to_numpy()
    y = np.stack([(df.hs > df["as"]), (df.hs == df["as"]), (df.hs < df["as"])], 1).astype(float)
    rps = 0.5 * (((np.cumsum(p, 1) - np.cumsum(y, 1))[:, :2]) ** 2).sum(1)
    ll = -np.log(np.clip((p * y).sum(1), 1e-12, None))
    brier = ((p - y) ** 2).sum(1)
    acc = (p.argmax(1) == y.argmax(1))
    return {"n": int(len(df)), "rps": float(rps.mean()), "logloss": float(ll.mean()),
            "brier": float(brier.mean()), "accuracy": float(acc.mean())}


def calibration(df: pd.DataFrame) -> pd.DataFrame:
    """Favourite's predicted win prob (binned) vs how often the favourite won."""
    p = df[["pH", "pD", "pA"]].to_numpy()
    fav = np.where(df.pH >= df.pA, 0, 2)
    pf = p[np.arange(len(df)), fav]
    won = np.where(fav == 0, df.hs > df["as"], df["as"] > df.hs)
    bins = pd.cut(pf, [0, .35, .45, .55, .65, .75, 1.0])
    return (pd.DataFrame({"bin": bins, "pred": pf, "won": won})
            .groupby("bin", observed=True).agg(n=("won", "size"), pred=("pred", "mean"), won=("won", "mean")))


def main():
    players = load_players()
    ratings = club_ratings(players)
    games = _with_ratings(load_games(), ratings)

    # 1) Tune ξ / pen per model on 2024/25 only.
    best = {}
    tuning = []
    for kind, grid in GRID.items():
        for xi, pen in itertools.product(grid["xi"], grid["pen"]):
            m = metrics(walk_forward(games, kind, xi, pen, [TUNE_SEASON]))
            tuning.append({"model": kind, "xi": xi, "pen": pen, **m})
            print(f"tune {kind:8s} xi={xi:<6} pen={pen:<5} rps={m['rps']:.4f} ll={m['logloss']:.4f}")
            if kind not in best or m["rps"] < best[kind]["rps"]:
                best[kind] = {"xi": xi, "pen": pen, "rps": m["rps"]}

    # 2) Holdout with the chosen settings.
    preds = {k: walk_forward(games, k, v["xi"], v["pen"], TEST_SEASONS) for k, v in best.items()}
    rows = []
    for season in TEST_SEASONS + ["all"]:
        for k, df in preds.items():
            d = df if season == "all" else df[df.season == season]
            rows.append({"season": season, "model": k, **metrics(d)})
        d = preds["hybrid"] if season == "all" else preds["hybrid"][preds["hybrid"].season == season]
        rows.append({"season": season, "model": "base-rate", **metrics(d, ("bH", "bD", "bA"))})
    holdout = pd.DataFrame(rows)
    print("\n", holdout.to_string(index=False))

    per_league = pd.DataFrame([{"league": lg, "model": k, **metrics(df[df.league == lg])}
                               for k, df in preds.items() for lg in BIG5])
    # Early-season slice: first 8 weeks of each test season (where value should matter most).
    early = {}
    for k, df in preds.items():
        first = df.groupby(["league", "season"]).game_date.transform("min")
        early[k] = metrics(df[df.game_date < first + pd.Timedelta(days=56)])
    calib = {k: calibration(df) for k, df in preds.items()}

    pd.DataFrame(tuning).to_csv(_OUT / "backtest_tuning.csv", index=False)
    holdout.to_csv(_OUT / "backtest_holdout.csv", index=False)
    per_league.to_csv(_OUT / "backtest_per_league.csv", index=False)
    for k, df in preds.items():
        df.to_csv(_OUT / f"backtest_preds_{k}.csv", index=False)
    with open(_OUT / "backtest_summary.json", "w") as f:
        json.dump({"best": best, "early_season": early,
                   "calibration": {k: c.reset_index().astype({"bin": str}).to_dict("records")
                                   for k, c in calib.items()},
                   "fitted_last": {k: df.iloc[-1][["home_adv", "beta_a", "beta_d", "rho"]].to_dict()
                                   for k, df in preds.items()}},
                  f, indent=2, default=float)
    print("\nearly-season:", json.dumps(early, indent=1))
    for k, c in calib.items():
        print(f"\ncalibration {k}\n{c}")


if __name__ == "__main__":
    main()
