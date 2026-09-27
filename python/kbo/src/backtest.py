"""Backtest the bottom-up engine on 2015-2019 (v2, the key validation gate).

For each clean 10-team season, build team ratings from the real full rosters, run the
144-game + postseason Monte-Carlo, and compare to what actually happened:

  * **standings** — Spearman ρ between predicted mean wins and actual wins (reconstruction
    quality: can the engine turn real player lines into the real table?);
  * **champion** — did the model's top Korean-Series pick / its odds credit the team that
    actually won it? (a genuinely hard, high-variance target).

Ground truth: actual wins from the open choosunsick game log (`data.load_game_results`),
Korean Series champions from `config.KS_CHAMPIONS`. Reported as-is — nothing is tuned per
season.
"""
from __future__ import annotations

from functools import partial

import numpy as np
import pandas as pd

from . import config, data, league_constants as lc, team_build as tbuild
from . import postseason as post
from .season_simulate import Season


def actual_standings(season: int) -> pd.Series:
    """Actual regular-season wins per franchise from the open game log."""
    g = data.load_game_results(seasons=[season])
    wins = {}
    for _, r in g.iterrows():
        h, a = r["home_franchise"], r["away_franchise"]
        if r["home_score"] > r["away_score"]:
            wins[h] = wins.get(h, 0) + 1
        elif r["away_score"] > r["home_score"]:
            wins[a] = wins.get(a, 0) + 1
    return pd.Series(wins, name="actual_wins").sort_values(ascending=False)


def run_season(season: int, sims: int = 30000, seed: int = 42, **build_kw) -> dict:
    c = lc.open_constants(season)
    ratings = tbuild.build_team_ratings(season, constants=c, **build_kw)
    rs = ratings["rs_per_game"].to_dict()
    ra = ratings["ra_per_game"].to_dict()
    lg_rg = c["lg_R_per_G"]
    pfn = lambda rng, seeds, srs, sra: post.simulate_postseason(rng, seeds, srs, sra, lg_rg)
    out = Season(rs, ra, lg_rg, seed=seed).run(sims, chunk=15000, postseason_fn=pfn)
    return ratings, out


def evaluate(seasons=None, sims: int = 30000, **build_kw) -> pd.DataFrame:
    seasons = seasons or config.BACKTEST_SEASONS
    rows = []
    for s in seasons:
        ratings, out = run_season(s, sims=sims, **build_kw)
        pred_wins = pd.Series(out["mean_wins"])
        actual = actual_standings(s)
        common = [t for t in pred_wins.index if t in actual.index]
        rho = pred_wins[common].rank().corr(actual[common].rank(), method="pearson")
        champ_pick = max(out["champion_prob"], key=out["champion_prob"].get)
        actual_champ = config.KS_CHAMPIONS[s]
        rows.append({
            "season": s,
            "standings_rho": round(rho, 3),
            "pick": champ_pick, "pick_ko": data.TEAM_KO[champ_pick],
            "actual_champ": actual_champ, "actual_champ_ko": data.TEAM_KO[actual_champ],
            "pick_correct": champ_pick == actual_champ,
            "champ_prob_of_actual": round(out["champion_prob"][actual_champ] * 100, 1),
            "actual_champ_reg_rank": int(actual.index.get_loc(actual_champ)) + 1
            if actual_champ in actual.index else None,
        })
    df = pd.DataFrame(rows)
    return df


if __name__ == "__main__":
    df = evaluate()
    print(df.to_string(index=False))
    print(f"\nmean standings Spearman rho: {df['standings_rho'].mean():.3f}")
    print(f"champion hit-rate: {df['pick_correct'].mean()*100:.0f}% "
          f"({df['pick_correct'].sum()}/{len(df)})")
    print(f"mean modeled prob assigned to the actual champion: {df['champ_prob_of_actual'].mean():.1f}% "
          f"(naive = {100/10:.0f}%)")
