"""Compare the 2026 simulation (kbo.json / kbo-matchup.json) against the ACTUAL
2026 game results collected from Naver, and surface where the model is off.

Reads:
  * kbo/data/raw/kbo_games/naver_KBO_2026_played.csv  (completed games w/ scores)
  * kbo/outputs/kbo.json          (season sim: proj_wins, championship, rs/ra)
  * kbo/outputs/kbo-matchup.json  (matchup engine: per-team rs/ra + league params)

Emits: actual standings vs projection, rank correlation, per-team residuals,
run-environment + home-field deltas, per-team RS/RA misses, and a game-level
calibration of the matchup engine (Brier / accuracy vs baselines).
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.stats import nbinom, spearmanr

from kbo.src import config, game_model as gm

PLAYED = config.RAW_DIR / "kbo_games" / "naver_KBO_2026_played.csv"


def actual_standings(df: pd.DataFrame) -> pd.DataFrame:
    """Per-team W/L/T, win% (ties excluded, KBO convention), RS/RA per game."""
    teams = sorted(set(df["home_franchise"]) | set(df["away_franchise"]))
    rows = []
    for t in teams:
        h = df[df["home_franchise"] == t]
        a = df[df["away_franchise"] == t]
        w = int((h["home_score"] > h["away_score"]).sum() + (a["away_score"] > a["home_score"]).sum())
        l = int((h["home_score"] < h["away_score"]).sum() + (a["away_score"] < a["home_score"]).sum())
        tie = int((h["home_score"] == h["away_score"]).sum() + (a["away_score"] == a["home_score"]).sum())
        gp = w + l + tie
        rs = int(h["home_score"].sum() + a["away_score"].sum())
        ra = int(h["away_score"].sum() + a["home_score"].sum())
        rows.append({"code": t, "W": w, "L": l, "T": tie, "GP": gp,
                     "win_pct": w / (w + l) if (w + l) else np.nan,
                     "rs_pg": rs / gp, "ra_pg": ra / gp})
    return pd.DataFrame(rows).sort_values("win_pct", ascending=False).reset_index(drop=True)


def p_home_win(rs_h, ra_h, rs_a, ra_a, lg_rg, kmax=40) -> float:
    """P(home decisive win) under the matchup engine's independent-NegBinom scores."""
    lam_h, lam_a = gm.expected_runs_pair(rs_h, ra_h, rs_a, ra_a, lg_rg, home_adv=True)
    grid = np.arange(kmax + 1)
    ph = nbinom.pmf(grid, gm.DISPERSION_K, gm.DISPERSION_K / (gm.DISPERSION_K + lam_h))
    pa = nbinom.pmf(grid, gm.DISPERSION_K, gm.DISPERSION_K / (gm.DISPERSION_K + lam_a))
    M = np.outer(ph, pa)                       # M[h,a] = P(home=h, away=a)
    p_h = np.tril(M, -1).sum()                 # home > away
    p_a = np.triu(M, 1).sum()                  # away > home
    return p_h / (p_h + p_a)                   # decisive-game home-win prob


def main():
    played = pd.read_csv(PLAYED)
    played = played[played["cancel"] == False]
    st = actual_standings(played)

    sim = json.load(open(config.OUTPUTS_DIR / "kbo.json"))
    mj = json.load(open(config.OUTPUTS_DIR / "kbo-matchup.json"))
    lg_rg = mj["league"]["lg_R_per_G"]
    smap = {t["ko"]: t for t in sim["teams"]}
    ko = {t["code"]: t["ko"] for t in mj["teams"]}
    mmap = {t["code"]: t for t in mj["teams"]}

    # --- attach projections to actual standings ---
    st["ko"] = st["code"].map(ko)
    st["proj_wins"] = st["ko"].map(lambda k: smap[k]["proj_wins"])
    st["proj_win_pct"] = st["proj_wins"] / config.GAMES_PER_TEAM
    st["champ_prob"] = st["ko"].map(lambda k: smap[k]["championship"])
    st["proj_rank"] = st["proj_wins"].rank(ascending=False).astype(int)
    st["actual_rank"] = st["win_pct"].rank(ascending=False).astype(int)
    st["resid"] = st["proj_win_pct"] - st["win_pct"]        # + = model too high

    # === A. standings: predicted vs actual ===
    print("=" * 78)
    print(f"ACTUAL 2026 STANDINGS vs SIM  (through {played['date'].max()}, "
          f"{len(played)} games, ~{int(st['GP'].mean())} g/team)")
    print("=" * 78)
    print(f"{'#':>2} {'team':<5} {'W-L-T':>10} {'win%':>6} | {'proj#':>5} {'projW':>6} "
          f"{'projWin%':>8} {'champ%':>7} {'Δwin%':>7}")
    for _, r in st.iterrows():
        print(f"{r['actual_rank']:>2} {r['ko']:<5} {r['W']:>3}-{r['L']:>3}-{r['T']:>2} "
              f"{r['win_pct']:>6.3f} | {r['proj_rank']:>5} {r['proj_wins']:>6.1f} "
              f"{r['proj_win_pct']:>8.3f} {r['champ_prob']:>6.1f}% {r['resid']:>+7.3f}")

    rho, _ = spearmanr(st["proj_wins"], st["win_pct"])
    mae = st["resid"].abs().mean()
    print(f"\n  Spearman ρ(projW, actual win%) = {rho:.3f}   |   MAE(win%) = {mae:.3f}")
    print(f"  title pick: {sim['title_pick']['ko']} ({sim['title_pick']['prob']}%) "
          f"→ actually rank {int(st.loc[st['ko']==sim['title_pick']['ko'],'actual_rank'].iloc[0])}, "
          f"win% {st.loc[st['ko']==sim['title_pick']['ko'],'win_pct'].iloc[0]:.3f}")

    # === B. biggest misses ===
    print("\n" + "-" * 78)
    print("BIGGEST RESIDUALS (proj win% − actual win%; + = model overrated)")
    for _, r in st.reindex(st["resid"].abs().sort_values(ascending=False).index).head(6).iterrows():
        tag = "OVER-rated" if r["resid"] > 0 else "UNDER-rated"
        print(f"  {r['ko']:<5} proj {r['proj_win_pct']:.3f} vs actual {r['win_pct']:.3f}  "
              f"({r['resid']:+.3f})  {tag}   proj#{r['proj_rank']}→actual#{r['actual_rank']}")

    # === C. run environment + home field ===
    print("\n" + "-" * 78)
    print("RUN ENVIRONMENT & HOME FIELD")
    act_rpg = (played["home_score"].sum() + played["away_score"].sum()) / (2 * len(played))
    hw = (played["home_score"] > played["away_score"]).sum()
    aw = (played["home_score"] < played["away_score"]).sum()
    ties = (played["home_score"] == played["away_score"]).sum()
    dec_home = hw / (hw + aw)
    print(f"  league R/G:   model anchor {lg_rg:.3f}   actual {act_rpg:.3f}   "
          f"({act_rpg/lg_rg-1:+.1%})")
    print(f"  home-win%:    model target 0.538 (HOME_FACTOR {gm.HOME_FACTOR})   "
          f"actual decisive {dec_home:.3f}   (ties {ties/len(played):.3f})")

    # === D. per-team RS/RA: model vs actual ===
    print("\n" + "-" * 78)
    print("PER-TEAM RS / RA per game  (model = matchup engine rates)")
    print(f"{'team':<5} {'RS mdl':>7} {'RS act':>7} {'ΔRS':>6} | {'RA mdl':>7} {'RA act':>7} {'ΔRA':>6}")
    rs_err = ra_err = 0.0
    for _, r in st.sort_values("code").iterrows():
        m = mmap[r["code"]]
        drs, dra = r["rs_pg"] - m["rs_per_game"], r["ra_pg"] - m["ra_per_game"]
        rs_err += abs(drs); ra_err += abs(dra)
        print(f"{r['ko']:<5} {m['rs_per_game']:>7.2f} {r['rs_pg']:>7.2f} {drs:>+6.2f} | "
              f"{m['ra_per_game']:>7.2f} {r['ra_pg']:>7.2f} {dra:>+6.2f}")
    print(f"  MAE  RS {rs_err/len(st):.2f}   RA {ra_err/len(st):.2f} runs/game")

    # === E. game-level calibration of the matchup engine ===
    print("\n" + "-" * 78)
    print("GAME-LEVEL CALIBRATION (matchup engine P(home win) vs actual, decisive games)")
    dec = played[played["home_score"] != played["away_score"]].copy()
    ph = []
    for _, g in dec.iterrows():
        h, a = mmap.get(g["home_franchise"]), mmap.get(g["away_franchise"])
        ph.append(p_home_win(h["rs_per_game"], h["ra_per_game"],
                             a["rs_per_game"], a["ra_per_game"], lg_rg))
    dec["p_home"] = ph
    dec["home_won"] = (dec["home_score"] > dec["away_score"]).astype(int)
    brier = ((dec["p_home"] - dec["home_won"]) ** 2).mean()
    acc = ((dec["p_home"] > 0.5) == dec["home_won"]).mean()
    ll = -(dec["home_won"] * np.log(dec["p_home"].clip(1e-6, 1 - 1e-6))
           + (1 - dec["home_won"]) * np.log((1 - dec["p_home"]).clip(1e-6, 1 - 1e-6))).mean()
    base_home = dec["home_won"].mean()                       # always-home baseline
    brier_base = ((base_home - dec["home_won"]) ** 2).mean()
    print(f"  n decisive = {len(dec)}")
    print(f"  Brier   model {brier:.4f}   vs always-p=0.5 {0.25:.4f}   vs always-home {brier_base:.4f}")
    print(f"  Accuracy model {acc:.3f}   (always-home {base_home:.3f})")
    print(f"  LogLoss model {ll:.4f}   (coin {np.log(2):.4f})")
    # reliability: are model favorites winning at the rate claimed?
    dec["bin"] = pd.cut(dec["p_home"], [0, .45, .5, .55, .6, 1.0])
    rel = dec.groupby("bin", observed=True).agg(n=("home_won", "size"),
                                                pred=("p_home", "mean"),
                                                obs=("home_won", "mean"))
    print("  reliability (pred vs observed home-win rate by bin):")
    for b, row in rel.iterrows():
        print(f"    {str(b):<14} n={int(row['n']):>3}  pred {row['pred']:.3f}  obs {row['obs']:.3f}")


if __name__ == "__main__":
    main()
