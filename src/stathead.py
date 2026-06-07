"""Stathead CSV ingestion — normalizes exports to match the worldfootballR_data RDS schema.

## How to export from stathead

### Player stats (FBref finder)
Go to https://www.sports-reference.com/stathead/fb/players/season-finder/ and for each
table type (standard, shooting, passing, possession, defense, misc), filter by season
and export to CSV. Save files as:

    data/raw/stathead/
      fbref_standard_<season_end_year>.csv   e.g. fbref_standard_2024.csv
      fbref_shooting_<season_end_year>.csv
      fbref_passing_<season_end_year>.csv
      fbref_possession_<season_end_year>.csv
      fbref_defense_<season_end_year>.csv
      fbref_misc_<season_end_year>.csv

### Transfers (FBref transfers finder)
Go to https://www.sports-reference.com/stathead/fb/transfers/ and filter by season.
Export to CSV and save as:

    data/raw/stathead/
      transfers_<season_end_year>.csv    e.g. transfers_2024.csv  (= summer 2023 window)

The season_end_year convention matches the RDS: a transfer in the summer 2023 window
(buying club for the 2023/24 season) is season_end_year=2024 in FBref stats, but
season="2023" in TM transfers (the year the fee was paid). Use season="2023" in the
transfers CSV filename.

## Column mapping
Stathead CSV exports use the same headers as the FBref tables displayed on-site,
which match the RDS column names closely. The normalization below handles the few
known differences (e.g. "Squad" vs "Team", age format differences, fee currencies).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

import pandas as pd

from . import config

log = logging.getLogger(__name__)

STATHEAD_RAW_DIR = config.STATHEAD_RAW_DIR

# ---------------------------------------------------------------------------
# FBref stat table ingestion
# ---------------------------------------------------------------------------

# Maps stathead CSV header → RDS column name, for columns that differ.
# Stathead exports mostly match FBref on-site column names which already match
# the RDS. Only list the ones that actually diverge.
_STAT_COLUMN_MAP: dict[str, str] = {
    "Team": "Squad",
    "Season": "Season_End_Year",   # stathead uses "2023-24" → we parse to 2024
    "Rk": None,                    # row rank — drop
    "Matches": None,               # link column — drop
}


def _parse_season_end_year(season_str: str | float) -> int | None:
    """'2023-24' → 2024, '2024' → 2024, or None if unparseable."""
    s = str(season_str).strip()
    m = re.match(r"(\d{4})-(\d{2,4})", s)
    if m:
        year_prefix = m.group(1)[:2]
        end_part = m.group(2)
        if len(end_part) == 2:
            return int(year_prefix + end_part)
        return int(end_part)
    if re.fullmatch(r"\d{4}", s):
        return int(s)
    return None


def _normalize_stat_df(df: pd.DataFrame) -> pd.DataFrame:
    """Apply column renames and drops, parse Season_End_Year."""
    df = df.copy()
    # Drop columns mapped to None
    drop_cols = [k for k, v in _STAT_COLUMN_MAP.items() if v is None and k in df.columns]
    df = df.drop(columns=drop_cols, errors="ignore")
    # Rename
    rename = {k: v for k, v in _STAT_COLUMN_MAP.items() if v is not None and k in df.columns}
    df = df.rename(columns=rename)

    # Parse Season_End_Year if it's a string range like "2023-24"
    if "Season_End_Year" in df.columns:
        df["Season_End_Year"] = df["Season_End_Year"].map(_parse_season_end_year)
        df = df.dropna(subset=["Season_End_Year"])
        df["Season_End_Year"] = df["Season_End_Year"].astype(int)

    # stathead CSVs sometimes have a blank header row at top — drop if all NaN
    df = df.dropna(how="all")

    # Drop the repeated header rows stathead injects every 25 rows
    if "Player" in df.columns:
        df = df[df["Player"] != "Player"]

    return df.reset_index(drop=True)


def load_stathead_stats(
    table: str,
    seasons: list[int] | None = None,
    raw_dir: Path | None = None,
) -> pd.DataFrame:
    """Load stathead FBref stat CSVs for a given table type.

    `table` is one of: standard, shooting, passing, possession, defense, misc.
    `seasons` filters by Season_End_Year (int). If None, returns all found files.
    `raw_dir` defaults to config.STATHEAD_RAW_DIR.

    Returns a DataFrame with the same column convention as the RDS stat tables
    (Season_End_Year, Squad, Player as join keys).
    """
    raw_dir = raw_dir or STATHEAD_RAW_DIR
    pattern = f"fbref_{table}_*.csv"
    files = sorted(raw_dir.glob(pattern))
    if not files:
        log.debug("No stathead %s CSVs found in %s", table, raw_dir)
        return pd.DataFrame()

    frames: list[pd.DataFrame] = []
    for f in files:
        # Extract season_end_year from filename as a pre-filter
        m = re.search(r"_(\d{4})\.csv$", f.name)
        if m and seasons is not None:
            if int(m.group(1)) not in seasons:
                continue
        try:
            df = pd.read_csv(f, encoding="utf-8-sig", dtype=str)
        except Exception:
            log.warning("Could not read %s — skipping", f)
            continue
        df = _normalize_stat_df(df)
        if seasons is not None and "Season_End_Year" in df.columns:
            df = df[df["Season_End_Year"].isin(seasons)]
        if not df.empty:
            frames.append(df)
            log.info("Loaded stathead %s: %d rows from %s", table, len(df), f.name)

    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Transfer ingestion
# ---------------------------------------------------------------------------

# Stathead transfers finder column names → RDS big5_transfers.rds column names
_TRANSFER_COLUMN_MAP: dict[str, str | None] = {
    "Rk": None,
    "Player": "player_name",
    "Age": "player_age",
    "Nationality": "player_nationality",
    "Position": "player_pos",
    "From": "club_1",
    "To": "club_2",
    "League.From": "league_from",
    "League.To": "league",          # destination league (matches RDS "league" field)
    "Fee": "transfer_fee_raw",      # raw string like "€15.0M" — parsed below
    "Season": "season",             # "2023-24" → "2023" (TM convention: year fee paid)
    "Loan": "is_loan",
    "Matches": None,
}

_FEE_MULTIPLIERS = {"M": 1_000_000, "K": 1_000, "B": 1_000_000_000}


def _parse_fee_eur(fee_str: str | float) -> float | None:
    """'€15.0M' → 15_000_000.0, '€500K' → 500_000.0, or None."""
    s = str(fee_str).strip()
    # Remove currency symbol and commas
    s = s.replace("€", "").replace(",", "").strip()
    m = re.match(r"^([\d.]+)\s*([MKBmkb]?)$", s)
    if not m:
        return None
    val = float(m.group(1))
    suffix = m.group(2).upper()
    return val * _FEE_MULTIPLIERS.get(suffix, 1)


def _parse_transfer_season(season_str: str | float) -> str | None:
    """'2023-24' → '2023' (the year the summer window fee was paid), per TM convention."""
    s = str(season_str).strip()
    m = re.match(r"^(\d{4})-\d{2,4}$", s)
    if m:
        return m.group(1)
    if re.fullmatch(r"\d{4}", s):
        return s
    return None


def _normalize_transfer_df(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize a stathead transfers CSV to match big5_transfers.rds schema."""
    df = df.copy()
    df = df.dropna(how="all")

    # Drop repeated header rows
    if "Player" in df.columns:
        df = df[df["Player"] != "Player"]

    # Drop/rename columns
    drop_cols = [k for k, v in _TRANSFER_COLUMN_MAP.items() if v is None and k in df.columns]
    df = df.drop(columns=drop_cols, errors="ignore")
    rename = {k: v for k, v in _TRANSFER_COLUMN_MAP.items() if v is not None and k in df.columns}
    df = df.rename(columns=rename)

    # Parse fee → numeric EUR float
    if "transfer_fee_raw" in df.columns:
        df["transfer_fee"] = df["transfer_fee_raw"].map(_parse_fee_eur)
        df = df.drop(columns=["transfer_fee_raw"])

    # Parse season string
    if "season" in df.columns:
        df["season"] = df["season"].map(_parse_transfer_season)

    # Normalise is_loan → bool
    if "is_loan" in df.columns:
        df["is_loan"] = df["is_loan"].astype(str).str.strip().str.lower().isin(["yes", "true", "1", "loan"])

    # All stathead transfer exports are arrivals at the destination club
    df["transfer_type"] = "Arrivals"

    # Canonicalise league names to match RDS ("Premier League", "La Liga", etc.)
    if "league" in df.columns:
        df["league"] = df["league"].map(_canonicalize_league).fillna(df["league"])

    return df.reset_index(drop=True)


# Stathead league name variants → TM RDS canonical names used in existing filters
_LEAGUE_CANON: dict[str, str] = {
    "eng premier league": "Premier League",
    "premier league": "Premier League",
    "eng-premier league": "Premier League",
    "esp la liga": "La Liga",
    "la liga": "La Liga",
    "esp-la liga": "La Liga",
    "ita serie a": "Serie A",
    "serie a": "Serie A",
    "ita-serie a": "Serie A",
    "ger bundesliga": "Bundesliga",
    "bundesliga": "Bundesliga",
    "ger-bundesliga": "Bundesliga",
    "fra ligue 1": "Ligue 1",
    "ligue 1": "Ligue 1",
    "fra-ligue 1": "Ligue 1",
    "eng championship": "Championship",
    "championship": "Championship",
    "ned eredivisie": "Eredivisie",
    "eredivisie": "Eredivisie",
}


def _canonicalize_league(name: str | float) -> str | None:
    return _LEAGUE_CANON.get(str(name).strip().lower())


def load_stathead_transfers(
    seasons: list[int | str] | None = None,
    raw_dir: Path | None = None,
    disclosed_fee_only: bool = True,
    drop_loans: bool = True,
) -> pd.DataFrame:
    """Load stathead transfer CSVs and normalize to big5_transfers.rds schema.

    `seasons` — list of season start years as ints or strings (e.g. [2023, 2024]).
    Files should be named transfers_<season_start_year>.csv (e.g. transfers_2023.csv).
    """
    raw_dir = raw_dir or STATHEAD_RAW_DIR
    files = sorted(raw_dir.glob("transfers_*.csv"))
    if not files:
        log.debug("No stathead transfer CSVs found in %s", raw_dir)
        return pd.DataFrame()

    str_seasons = [str(s) for s in seasons] if seasons is not None else None

    frames: list[pd.DataFrame] = []
    for f in files:
        m = re.search(r"transfers_(\d{4})\.csv$", f.name)
        if m and str_seasons is not None:
            if m.group(1) not in str_seasons:
                continue
        try:
            df = pd.read_csv(f, encoding="utf-8-sig", dtype=str)
        except Exception:
            log.warning("Could not read %s — skipping", f)
            continue
        df = _normalize_transfer_df(df)
        if str_seasons is not None and "season" in df.columns:
            df = df[df["season"].isin(str_seasons)]
        if disclosed_fee_only and "transfer_fee" in df.columns:
            df = df[df["transfer_fee"].notna() & (df["transfer_fee"] > 0)]
        if drop_loans and "is_loan" in df.columns:
            df = df[df["is_loan"] != True]  # noqa: E712
        if not df.empty:
            frames.append(df)
            log.info("Loaded stathead transfers: %d rows from %s", len(df), f.name)

    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Deduplication helper
# ---------------------------------------------------------------------------

def deduplicate_against_rds(
    stathead_df: pd.DataFrame,
    rds_df: pd.DataFrame,
    key_cols: list[str],
) -> pd.DataFrame:
    """Remove stathead rows that are already in the RDS dataset by key match.

    Uses a normalized string join key to avoid whitespace/case duplicates.
    """
    import unicodedata

    def _norm(s: pd.Series) -> pd.Series:
        return s.fillna("").astype(str).map(
            lambda x: " ".join(
                unicodedata.normalize("NFKD", x.strip().lower())
                .encode("ascii", "ignore")
                .decode("ascii")
                .split()
            )
        )

    # Build a composite key string for each row
    def _make_key(df: pd.DataFrame) -> pd.Series:
        parts = [_norm(df[c].astype(str)) for c in key_cols if c in df.columns]
        return parts[0].str.cat(parts[1:], sep="|") if len(parts) > 1 else parts[0]

    rds_keys = set(_make_key(rds_df))
    sh_keys = _make_key(stathead_df)
    mask = ~sh_keys.isin(rds_keys)
    kept = stathead_df[mask].copy()
    dropped = (~mask).sum()
    if dropped:
        log.info("Deduplication: dropped %d stathead rows already in RDS", dropped)
    return kept.reset_index(drop=True)
