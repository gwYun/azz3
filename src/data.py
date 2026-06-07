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
from .stathead import (
    deduplicate_against_rds,
    load_stathead_stats,
    load_stathead_transfers,
)

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


# Cols that recur across the six FBref tables (Comp, Nation, Pos, Age, Born,
# Mins_Per_90, Url). We keep them from the standard table and drop the dupes
# elsewhere — same player-season has identical metadata across tables.
_FBREF_OVERLAP_DROP = ["Comp", "Nation", "Pos", "Age", "Born", "Mins_Per_90", "Url"]
_FBREF_JOIN_KEYS = ["Season_End_Year", "Squad", "Player"]
_FBREF_AUX_TABLES = [
    ("big5_player_shooting.rds", "_shoot"),
    ("big5_player_passing.rds", "_pass"),
    ("big5_player_possession.rds", "_poss"),
    ("big5_player_defense.rds", "_def"),
    ("big5_player_misc.rds", "_misc"),
]


def load_fbref_all_stats(seasons: list[int] | None = None) -> pd.DataFrame:
    """Merge standard + shooting + passing + possession + defense + misc.

    Joins on (Season_End_Year, Squad, Player). Non-standard tables have their
    non-key columns suffixed (e.g., 'Int' -> 'Int_def' / 'Int_misc') to avoid
    collisions. Returns one row per (player-season-club).
    """
    paths = download_wfr_data()
    base = _read_rds(paths["big5_player_standard.rds"])
    if seasons is not None:
        base = base[base["Season_End_Year"].isin(seasons)]

    for fname, suffix in _FBREF_AUX_TABLES:
        sup = _read_rds(paths[fname])
        if seasons is not None:
            sup = sup[sup["Season_End_Year"].isin(seasons)]
        sup = sup.drop(columns=[c for c in _FBREF_OVERLAP_DROP if c in sup.columns], errors="ignore")
        rename = {c: f"{c}{suffix}" for c in sup.columns if c not in _FBREF_JOIN_KEYS}
        sup = sup.rename(columns=rename)
        # Some aux tables have multiple rows per join key when a player switched
        # mid-season (rare). Keep the row with the most non-null aux columns.
        if sup.duplicated(_FBREF_JOIN_KEYS).any():
            sup["_nonnull"] = sup.notna().sum(axis=1)
            sup = sup.sort_values("_nonnull", ascending=False).drop_duplicates(_FBREF_JOIN_KEYS).drop(columns="_nonnull")
        base = base.merge(sup, on=_FBREF_JOIN_KEYS, how="left")
    # Append stathead CSV exports for seasons not covered by the RDS
    for table_name, suffix in [
        ("standard", ""),
        ("shooting", "_shoot"),
        ("passing", "_pass"),
        ("possession", "_poss"),
        ("defense", "_def"),
        ("misc", "_misc"),
    ]:
        sh_raw = load_stathead_stats(table=table_name, seasons=seasons)
        if sh_raw.empty:
            continue
        if table_name == "standard":
            sh_raw = deduplicate_against_rds(sh_raw, base, key_cols=["Player", "Season_End_Year", "Squad"])
            base = pd.concat([base, sh_raw], ignore_index=True)
            log.info("After stathead standard append: %d total stat rows", len(base))
        else:
            # Aux table: apply same suffix rename as RDS aux tables, then merge into base
            sh_aux = sh_raw.drop(columns=[c for c in _FBREF_OVERLAP_DROP if c in sh_raw.columns], errors="ignore")
            rename = {c: f"{c}{suffix}" for c in sh_aux.columns if c not in _FBREF_JOIN_KEYS}
            sh_aux = sh_aux.rename(columns=rename)
            base = base.merge(sh_aux, on=_FBREF_JOIN_KEYS, how="left", suffixes=("", f"_sh{suffix}"))

    return base.reset_index(drop=True)


def load_transfers(
    seasons: list[int] | None = None,
    inbound_pl_only: bool = False,
    disclosed_fee_only: bool = True,
    drop_loans: bool = True,
) -> pd.DataFrame:
    """Big-5 transfers from Transfermarkt.

    `seasons` filters by `season` column (str like '2022').
    Filters apply by default per the design doc:
      - inbound to any Big-5 club (all leagues) when inbound_pl_only=False;
        inbound to a Big-5 PL club (transfer_type == 'Arrivals' AND league == 'Premier League')
        when inbound_pl_only=True
      - disclosed fee only (transfer_fee not null and > 0)
      - no loans (is_loan == False)
    """
    paths = download_wfr_data()
    df = _read_rds(paths["big5_transfers.rds"])

    if seasons is not None:
        df = df[df["season"].astype(str).isin([str(s) for s in seasons])]
    if inbound_pl_only:
        df = df[(df["league"] == "Premier League") & (df["transfer_type"] == "Arrivals")]
    else:
        df = df[df["transfer_type"] == "Arrivals"]
    if disclosed_fee_only:
        df = df[df["transfer_fee"].notna() & (df["transfer_fee"] > 0)]
    if drop_loans:
        df = df[df["is_loan"] != True]  # noqa: E712 — explicit-False filter

    # Append stathead CSV exports (covers 2023+ windows not in the RDS)
    sh = load_stathead_transfers(
        seasons=seasons,
        disclosed_fee_only=disclosed_fee_only,
        drop_loans=drop_loans,
    )
    if not sh.empty:
        sh = deduplicate_against_rds(sh, df, key_cols=["player_name", "season", "transfer_fee"])
        if inbound_pl_only and "league" in sh.columns:
            sh = sh[sh["league"] == "Premier League"]
        df = pd.concat([df, sh], ignore_index=True)
        log.info("After stathead append: %d total transfer rows", len(df))

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


def load_player_vals_for_join(seasons: list[int] | None = None) -> pd.DataFrame:
    """Player vals reduced + parsed, deduped to one row per (player_url, season_start_year).

    Picks the row with the highest market value when a player has multiple
    snapshots in the same season (mid-season club switch).
    """
    df = load_player_vals(seasons=seasons)
    keep = [
        "player_url", "season_start_year",
        "player_height_mtrs", "player_foot",
        "contract_expiry", "date_joined",
        "player_market_value_euro",
    ]
    out = df[keep].copy()
    out["player_height_mtrs"] = pd.to_numeric(out["player_height_mtrs"], errors="coerce")
    foot = out["player_foot"].astype(str).str.strip().str.lower()
    out["player_foot"] = foot.where(foot.isin(["right", "left", "both"]))
    out["contract_expiry_year"] = pd.to_datetime(out["contract_expiry"], errors="coerce").dt.year
    out["date_joined_year"] = pd.to_datetime(out["date_joined"], errors="coerce").dt.year
    out = out.drop(columns=["contract_expiry", "date_joined"])

    # Dedupe: keep highest market value per (player_url, season_start_year).
    out = out.sort_values("player_market_value_euro", ascending=False, na_position="last")
    out = out.drop_duplicates(["player_url", "season_start_year"]).reset_index(drop=True)
    return out


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


def attach_prior_player_vals(joined: pd.DataFrame, vals: pd.DataFrame) -> pd.DataFrame:
    """Left-join player_vals snapshot from the season immediately before the transfer.

    Transfer season "2014" (summer 2014 window) is preceded by season_start_year=2013
    (the 2013/14 season). Joins on player_url + that mapping.

    Adds columns:
      prior_market_value_eur, player_height_mtrs, player_foot,
      contract_years_remaining, tenure_at_selling_club_years
    """
    if "player_url" not in joined.columns:
        raise KeyError("joined frame missing player_url; load_transfers must have run")

    j = joined.copy()
    j["_val_season_start"] = j["season"].astype(int) - 1

    v = vals.copy()
    v = v.rename(columns={"season_start_year": "_val_season_start"})

    out = j.merge(
        v,
        on=["player_url", "_val_season_start"],
        how="left",
        suffixes=("", "_v"),
    )

    transfer_year = out["season"].astype(int)
    out["prior_market_value_eur"] = pd.to_numeric(out["player_market_value_euro"], errors="coerce")
    out["contract_years_remaining"] = pd.to_numeric(out["contract_expiry_year"], errors="coerce") - transfer_year
    out["tenure_at_selling_club_years"] = transfer_year - pd.to_numeric(out["date_joined_year"], errors="coerce")

    out = out.drop(columns=[
        "player_market_value_euro", "contract_expiry_year", "date_joined_year", "_val_season_start",
    ], errors="ignore")
    return out.reset_index(drop=True)
