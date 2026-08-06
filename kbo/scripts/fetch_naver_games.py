"""Collect this season's KBO game results from Naver, politely spaced + cached.

One request per calendar month (default 3s apart), each month cached to
kbo/data/raw/naver_games/kbo_YYYY-MM.json so re-runs never re-hit the network.
Writes a consolidated per-season CSV (all games, with a `status` column) plus a
played-only CSV (completed games with scores) to kbo/data/raw/kbo_games/.

Run:  python -m kbo.scripts.fetch_naver_games                 # current season, Mar-Nov
      python -m kbo.scripts.fetch_naver_games --season 2026 --delay 4
      python -m kbo.scripts.fetch_naver_games --months 3 4 5 6 7 8 --force
"""
from __future__ import annotations

import argparse
import logging

from kbo.src import config, naver_games as ng

_OUT_DIR = config.RAW_DIR / "kbo_games"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=config.CURRENT_SEASON)
    ap.add_argument("--months", type=int, nargs="+", default=None,
                    help="calendar months to scan (default: 3..11, the KBO window)")
    ap.add_argument("--delay", type=float, default=3.0,
                    help="politeness delay (s) between month requests")
    ap.add_argument("--force", action="store_true", help="re-fetch even if a month is cached")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    months = args.months if args.months is not None else None

    df = ng.collect_season(args.season, months=months, use_cache=not args.force,
                           delay=args.delay)
    if df.empty:
        print(f"no {args.season} KBO games returned")
        return

    played = ng.played_games(df)
    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    all_path = _OUT_DIR / f"naver_KBO_{args.season}_all.csv"
    played_path = _OUT_DIR / f"naver_KBO_{args.season}_played.csv"
    df.to_csv(all_path, index=False)
    played.to_csv(played_path, index=False)

    # Sanity summary: span, counts, per-status, a league-realism check (home-win%).
    by_status = df["status"].value_counts().to_dict()
    span = f"{df['date'].min().date()} … {df['date'].max().date()}"
    print(f"\nseason {args.season}: {len(df)} games  ({span})")
    print(f"  by status: {by_status}")
    print(f"  played (scored): {len(played)}")
    if len(played):
        home_w = (played["home_score"] > played["away_score"]).mean()
        tie = (played["home_score"] == played["away_score"]).mean()
        rpg = (played["home_score"].sum() + played["away_score"].sum()) / (2 * len(played))
        print(f"  home-win {home_w:.3f} · tie {tie:.3f} · R/G {rpg:.2f}")
        gp = (played.groupby("home_franchise").size()
              .add(played.groupby("away_franchise").size(), fill_value=0).astype(int))
        print(f"  games/team: {gp.min()}–{gp.max()} across {gp.size} teams")
    print(f"\nwrote {all_path}\n      {played_path}")
    print(f"raw month cache: {ng._RAW_DIR}")


if __name__ == "__main__":
    main()
