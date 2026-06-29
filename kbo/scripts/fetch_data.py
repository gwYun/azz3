"""Pre-warm the KBO data caches and print a per-season sanity summary.

Pulls team-season totals + qualified-player leaderboards from the KBO official
/Record pages and the choosunsick game log, caching each to kbo/data/interim so
the model never hits the network again. Doubles as the Phase-1 verification gate:
the printed league summary (R/G, HR, BB rate, home-win%) should look like real KBO.

Run:  python -m kbo.scripts.fetch_data
      python -m kbo.scripts.fetch_data --seasons 2023 2024 2025 2026 --force
"""
from __future__ import annotations

import argparse
import logging

from kbo.src import config, data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+",
                    default=[2023, 2024, 2025, config.CURRENT_SEASON],
                    help="seasons to fetch (completed seasons feed the projection)")
    ap.add_argument("--force", action="store_true", help="re-fetch even if cached")
    ap.add_argument("--delay", type=float, default=0.6, help="politeness delay (s) between requests")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    client = data.KBORecordClient(delay=args.delay)
    use_cache = not args.force

    print(f"{'season':>6} {'teams':>5} {'G':>4} {'R/G':>5} {'HR':>5} {'BB%':>5} "
          f"{'ERA':>5} {'bats':>5} {'pits':>5}")
    for s in args.seasons:
        tb = data.team_batting(s, use_cache=use_cache, client=client)
        tp = data.team_pitching(s, use_cache=use_cache, client=client)
        pb = data.player_batting(s, use_cache=use_cache, client=client)
        pp = data.player_pitching(s, use_cache=use_cache, client=client)
        g = int(tb["G"].max())
        rpg = tb["R"].sum() / tb["G"].sum()                 # league runs per team-game
        hr = int(tb["HR"].sum())
        bb_rate = tb["BB"].sum() / tb["PA"].sum()
        era = (tp["ER"].sum() * 9.0) / tp["IP"].sum()
        print(f"{s:>6} {len(tb):>5} {g:>4} {rpg:>5.2f} {hr:>5} {bb_rate:>5.3f} "
              f"{era:>5.2f} {len(pb):>5} {len(pp):>5}")

    # Game log (for the simulator's run-variance + home-field calibration).
    games = data.load_game_results()
    by_season = games.groupby("season").size()
    home_w = (games["home_score"] > games["away_score"]).mean()
    tie = (games["home_score"] == games["away_score"]).mean()
    print(f"\ngame log: {len(games)} regular games, seasons "
          f"{int(by_season.index.min())}-{int(by_season.index.max())} "
          f"({by_season.min()}-{by_season.max()}/yr) | "
          f"home-win {home_w:.3f}, tie {tie:.3f}")
    print(f"caches written to {config.INTERIM_DIR}")


if __name__ == "__main__":
    main()
