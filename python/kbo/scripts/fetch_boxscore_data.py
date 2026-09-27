"""Pre-warm the v2 open-data caches (full rosters, 2010-2020) + sanity summary.

Downloads the robots-clean LOPES game-by-game dump once, decodes/aggregates every
season to full-roster batting/pitching tables, and prints a per-season league summary
(the Phase-1 gate: R/G, HR, ERA, roster sizes should look like real KBO).

Run:  python -m kbo.scripts.fetch_boxscore_data
"""
from __future__ import annotations

import logging

from kbo.src import config, boxscore_data as bd


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    bd.download()
    print(f"{'season':>6} {'batters':>7} {'pitchers':>8} {'bats/tm':>7} {'R/G':>5} {'HR':>5} {'ERA':>5}")
    for s in config.OPEN_DATA_SEASONS:
        b, p = bd.batting(s), bd.pitching(s)
        lt = bd.league_totals(s)
        rg = lt["bat"]["R"] / (config.TEAMS * config.GAMES_PER_TEAM)
        era = lt["pit"]["ER"] * 9.0 / lt["pit"]["IP"]
        print(f"{s:>6} {len(b):>7} {len(p):>8} {len(b)//10:>7} {rg:>5.2f} "
              f"{int(lt['bat']['HR']):>5} {era:>5.2f}")
    print(f"\ncaches -> {config.INTERIM_DIR}")


if __name__ == "__main__":
    main()
