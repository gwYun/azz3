"""Data ingestion via worldfootballR_data RDS dumps.

Locked decisions (post Issue I4 — pivot back to original plan via static dataset):

  Three RDS files, refreshed regularly by JaseZiv/worldfootballR_data on GitHub,
  give us everything the original plan needed:

    - big5_player_standard.rds   FBref Big-5 player season stats (38K rows,
                                 2010-2023, 34 cols incl. xG_Expected, Player URL)
    - big5_transfers.rds         Transfermarkt transfers Big-5 (63K rows,
                                 2010-2022, 24K with disclosed fee in EUR)
    - big5_player_vals.rds       TM market value snapshots (46K rows,
                                 2010-2023, EUR values, Player URL)

  This reverses Issues I2 (ScraperFC TM history broken -> no fees) and I3
  (FBref blocked by Cloudflare). We're back to the original "predict transfer
  fee from prior-season stats" target with a richer 14-year history, all
  joined locally via player_url. No scraping at runtime.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import rdata

from . import config

log = logging.getLogger(__name__)

WFR_BASE_URL = "https://github.com/JaseZiv/worldfootballR_data/raw/master/data"

WFR_FILES = {
    "fb_big5_advanced_season_stats/big5_player_standard.rds": "big5_player_standard.rds",
    "fb_big5_advanced_season_stats/big5_player_shooting.rds": "big5_player_shooting.rds",
    "fb_big5_advanced_season_stats/big5_player_passing.rds": "big5_player_passing.rds",
    "fb_big5_advanced_season_stats/big5_player_possession.rds": "big5_player_possession.rds",
    "fb_big5_advanced_season_stats/big5_player_defense.rds": "big5_player_defense.rds",
    "fb_big5_advanced_season_stats/big5_player_misc.rds": "big5_player_misc.rds",
    "tm_transfers/big_5_transfers.rds": "big5_transfers.rds",
    "tm_player_vals/big5_player_vals.rds": "big5_player_vals.rds",
}

WFR_LOCAL_DIR = config.RAW_DIR / "wfr"


def download_wfr_data(force: bool = False) -> dict[str, Path]:
    """Download (or skip-if-cached) the worldfootballR_data RDS files we use."""
    import urllib.request

    WFR_LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for remote, local in WFR_FILES.items():
        local_path = WFR_LOCAL_DIR / local
        if local_path.exists() and not force:
            out[local] = local_path
            continue
        url = f"{WFR_BASE_URL}/{remote}"
        log.info("Downloading %s ...", url)
        urllib.request.urlretrieve(url, local_path)
        out[local] = local_path
    return out


def _read_rds(path: Path) -> pd.DataFrame:
    """RDS -> DataFrame. Normalizes column names from numpy strings."""
    df = rdata.read_rds(str(path))
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
    # rdata returns column names as numpy strings; coerce to plain str.
    df.columns = [str(c) for c in df.columns]
    return df


def load_fbref_player_stats(
    seasons: list[int] | None = None,
    leagues: list[str] | None = None,
) -> pd.DataFrame:
    """FBref Big-5 player season standard stats.

    `seasons` filters by Season_End_Year (e.g., 2023 = 2022/23 season).
    `leagues` filters by Comp column (FBref names like 'Premier League').
    """
    paths = download_wfr_data()
    df = _read_rds(paths["big5_player_standard.rds"])
    if seasons is not None:
        df = df[df["Season_End_Year"].isin(seasons)]
    if leagues is not None:
        df = df[df["Comp"].isin(leagues)]
    return df.reset_index(drop=True)


def load_transfers(
    seasons: list[int] | None = None,
    inbound_pl_only: bool = True,
    disclosed_fee_only: bool = True,
    drop_loans: bool = True,
) -> pd.DataFrame:
    """Big-5 transfers from Transfermarkt.

    `seasons` filters by `season` column (str like '2022').
    Filters apply by default per the design doc:
      - inbound to a Big-5 PL club (transfer_type == 'Arrivals' AND league == 'Premier League')
      - disclosed fee only (transfer_fee not null and > 0)
      - no loans (is_loan == False)
    """
    paths = download_wfr_data()
    df = _read_rds(paths["big5_transfers.rds"])

    if seasons is not None:
        df = df[df["season"].astype(str).isin([str(s) for s in seasons])]
    if inbound_pl_only:
        df = df[(df["league"] == "Premier League") & (df["transfer_type"] == "Arrivals")]
    if disclosed_fee_only:
        df = df[df["transfer_fee"].notna() & (df["transfer_fee"] > 0)]
    if drop_loans:
        df = df[df["is_loan"] != True]  # noqa: E712 — explicit-False filter
    return df.reset_index(drop=True)


def load_player_vals(seasons: list[int] | None = None) -> pd.DataFrame:
    """TM player market values (Big-5).

    `seasons` filters by `season_start_year` (int).
    """
    paths = download_wfr_data()
    df = _read_rds(paths["big5_player_vals.rds"])
    if seasons is not None:
        df = df[df["season_start_year"].isin(seasons)]
    return df.reset_index(drop=True)


def _normalize_name(s: pd.Series) -> pd.Series:
    """Lowercase, strip, collapse whitespace, drop non-ASCII variants."""
    import unicodedata

    return s.fillna("").astype(str).map(
        lambda x: " ".join(
            unicodedata.normalize("NFKD", x.strip().lower())
            .encode("ascii", "ignore")
            .decode("ascii")
            .split()
        )
    )


def join_transfers_with_prior_season_stats(
    transfers: pd.DataFrame,
    stats: pd.DataFrame,
    age_tolerance: int = 1,
) -> pd.DataFrame:
    """Join each disclosed-fee transfer to the buyer's prior-season FBref stats.

    Join keys: normalized name + prior season + age within +/- tolerance.
    The TM and FBref URL schemes don't share IDs, so we use name+age+season
    matching. Age tolerance handles the within-year birthday boundary.

    Returns one row per matched (transfer, prior-season stats). Players whose
    prior season is missing from FBref Big-5 are dropped.
    """
    t = transfers.copy()
    t["_prior_season_end"] = t["season"].astype(int)
    t["_name_norm"] = _normalize_name(t["player_name"])
    t["_age"] = pd.to_numeric(t["player_age"], errors="coerce")

    s = stats.copy()
    s["_join_season_end"] = s["Season_End_Year"].astype(int)
    s["_name_norm"] = _normalize_name(s["Player"])
    s["_age"] = pd.to_numeric(s["Age"], errors="coerce")

    # First-pass: exact name+season match, then age-tolerance filter.
    base = t.merge(
        s,
        left_on=["_name_norm", "_prior_season_end"],
        right_on=["_name_norm", "_join_season_end"],
        how="inner",
        suffixes=("", "_stats"),
    )
    if "_age_stats" in base.columns:
        # When stats also has _age, suffix renaming kicks in.
        age_diff = (base["_age"] - base["_age_stats"]).abs()
    else:
        # On a clean inner-merge with same key '_age' on both sides, pandas
        # won't suffix unless there's a column name collision. Defensively
        # keep both _age columns visible.
        age_diff = pd.Series([0] * len(base))

    base = base[age_diff <= age_tolerance].copy()
    return base.reset_index(drop=True)
