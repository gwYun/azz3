"""Day 1 sample-size sanity check (worldfootballR_data path).

Downloads the three RDS files (~6MB total), counts inbound-PL disclosed-fee
transfers across 2018-2022, joins to prior-season FBref stats, and reports
how many rows survive.

Floor: MIN_TRAIN_N rows after the JOIN.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

from src import config  # noqa: E402
from src.data import (  # noqa: E402
    download_wfr_data,
    join_transfers_with_prior_season_stats,
    load_fbref_player_stats,
    load_transfers,
)


def main() -> int:
    print("=" * 60)
    print("DAY 1 SANITY CHECK — worldfootballR_data path")
    print("=" * 60)
    print(f"Floor: n >= {config.MIN_TRAIN_N} disclosed-fee inbound-PL transfers with prior-season FBref stats")
    print("Source: JaseZiv/worldfootballR_data (RDS dumps from GitHub)")
    print("-" * 60)

    print("Step 1: download RDS files (cached if already present)...")
    paths = download_wfr_data()
    for k, v in paths.items():
        size_kb = v.stat().st_size / 1024
        print(f"  {k}: {size_kb:.0f} KB")

    print()
    print("Step 2: load + filter transfers (Big-5 inbound-PL, disclosed fee, no loans)...")
    seasons = list(range(2014, 2023))  # 2014-2022, 9 windows
    transfers = load_transfers(seasons=seasons)
    print(f"  seasons: {seasons[0]}-{seasons[-1]} ({len(seasons)} windows)")
    print(f"  rows: {len(transfers)}")
    print(f"  fee distribution: median €{transfers['transfer_fee'].median()/1e6:.1f}M, "
          f"max €{transfers['transfer_fee'].max()/1e6:.1f}M")

    print()
    print("Step 3: load FBref Big-5 stats and JOIN by name + prior season + age...")
    # FBref Season_End_Year for prior-season stats: matches transfer season directly
    # (transfer season=2018 means summer-2018 window, prior season ended in 2018).
    stats = load_fbref_player_stats(seasons=seasons + [s + 1 for s in seasons])
    print(f"  FBref rows pulled: {len(stats)}")

    joined = join_transfers_with_prior_season_stats(transfers, stats, age_tolerance=2)
    print(f"  joined rows (transfer × prior-season stats): {len(joined)}")
    print(f"  drop rate (no prior FBref stats): {(1 - len(joined)/max(len(transfers),1))*100:.1f}%")

    n = len(joined)
    print("-" * 60)
    if n >= config.MIN_TRAIN_N:
        print(f"PASS: {n} >= {config.MIN_TRAIN_N}.")
        print(f"  median fee in joined: €{joined['transfer_fee'].median()/1e6:.1f}M")
        print(f"  seasons covered: {sorted(joined['season'].unique())}")
        print()
        print("Proceed to weekend 1 step 2: feature engineering + train/test split.")
        return 0
    print(f"ESCALATE: only {n} joined rows < {config.MIN_TRAIN_N}.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
