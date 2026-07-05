"""v2 bottom-up data: full rosters from the open LOPES game-by-game dump.

The KBO box-score API lives behind `/ws/*.asmx`, which robots.txt disallows, so we do
NOT scrape it. Instead we use the already-published LOPES-HUFS dataset (robots-clean
GitHub download): game-by-game batting/pitching lines for EVERY player, 2010-2020, with
positions — enough to build real rosters, lineups, playing time, and a backtest.

Batting hit-types are encoded as per-inning at-bat codes (`i_1..i_12`). We decode them
with the kbodatatools scheme (validated: 박병호 2015 → 53 HR, decoded hits == 안타):

    1B 1000-1029 / prefix 10   2B 11xx   3B 12xx   HR 13xx
    BB 30xx(+32xx)   IBB 32xx   HBP 31xx   SF 50xx   SH 41xx/61xx   GDP 72xx

8-digit codes pack two events (a runner event + the batter event); we split them into
two 4-digit codes and classify each half, exactly as check_record does. Strikeouts are
NOT decoded (code 2000 is a generic out, and wOBA/FIP-offense never use batter Ks;
pitcher Ks come from the clean 삼진 column).

Output tables share v1's canonical column names so `sabermetrics.py` consumes them
directly. Everything caches to parquet; the raw dump downloads once (skip-if-cached).
"""
from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from . import config
from .data import resolve_team

log = logging.getLogger(__name__)

_LOPES_BASE = "https://raw.githubusercontent.com/LOPES-HUFS/Data_Wrangling_for_KBO/master"
_FILES = {
    "batter.parquet": "sample/batter.parquet",
    "pitcher.parquet": "sample/pitcher.parquet",
    "player_info_list.csv": "data/player_info_list.csv",
}
_OPEN_DIR = config.RAW_DIR / "open_lopes"
_INN = [f"i_{k}" for k in range(1, 13)]

# 2-digit code prefix -> event bucket for wOBA (strikeouts intentionally excluded).
# Each event: (numeric-range low, high) for 4-digit codes + 2-digit prefix for 8-digit halves.
_EVENTS = {
    "B1":  (1000, 1029, "10"),
    "B2":  (1100, 1123, "11"),
    "B3":  (1200, 1222, "12"),
    "HR":  (1300, 1305, "13"),
    "uBB": (3000, 3100, "30"),   # unintentional walk
    "IBB": (3200, 3300, "32"),   # intentional walk (also counts toward BB)
    "HBP": (3100, 3200, "31"),
    "SF":  (5000, 5006, "50"),
    "SH_a": (4100, 4106, "41"),  # sac bunt (two encodings)
    "SH_b": (6100, 6108, "61"),
    "GDP": (7200, 7227, "72"),
}


def download(force: bool = False) -> dict[str, Path]:
    _OPEN_DIR.mkdir(parents=True, exist_ok=True)
    out = {}
    for local, remote in _FILES.items():
        dest = _OPEN_DIR / local
        if not dest.exists() or force:
            log.info("Downloading %s ...", remote)
            urllib.request.urlretrieve(f"{_LOPES_BASE}/{remote}", dest)
        out[local] = dest
    return out


# --------------------------------------------------------------------------- #
# Batting: decode at-bat codes -> per-player-season line.                      #
# --------------------------------------------------------------------------- #
_POS_BUCKET = {"1": "P", "2": "C", "3": "IF", "4": "IF", "5": "IF", "6": "IF",
               "7": "OF", "8": "OF", "9": "OF", "D": "DH", "H": "PH", "R": "PR"}


def _primary_position(pos_series: pd.Series) -> str:
    """Most-common real fielding bucket for a player-season (ignore PH/PR if possible)."""
    buckets = pos_series.astype(str).str[0].map(_POS_BUCKET).dropna()
    real = buckets[~buckets.isin(["PH", "PR"])]
    use = real if len(real) else buckets
    return use.mode().iloc[0] if len(use) else "DH"


def _decode_batting(bat: pd.DataFrame) -> pd.DataFrame:
    """Melt inning codes, split 8-digit two-event codes, classify, sum per player-season."""
    key = ["선수명", "year", "팀"]
    long = bat[key + _INN].melt(id_vars=key, value_name="code")
    long = long[(long["code"] != 0) & (long["code"] != -1)].copy()
    long["s"] = long["code"].astype(np.int64).astype(str)

    # split 8-digit codes into two 4-digit halves (two rows), keep others as-is
    eight = long[long["s"].str.len() == 8]
    if len(eight):
        h1 = eight.assign(s=eight["s"].str[0:4])
        h2 = eight.assign(s=eight["s"].str[4:8])
        long = pd.concat([long[long["s"].str.len() != 8], h1, h2], ignore_index=True)
    long["num"] = pd.to_numeric(long["s"], errors="coerce")
    long["pfx"] = long["s"].str[0:2]

    counts = {}
    for ev, (lo, hi, pfx) in _EVENTS.items():
        hit = ((long["num"] >= lo) & (long["num"] < hi)) | (long["pfx"] == pfx)
        counts[ev] = long[hit].groupby(key).size()
    ev_df = pd.DataFrame(counts).fillna(0).astype(int)
    ev_df["SH"] = ev_df.pop("SH_a") + ev_df.pop("SH_b")
    ev_df["BB"] = ev_df["uBB"] + ev_df["IBB"]

    # per-game aggregates + games + position
    agg = bat.groupby(key).agg(H=("안타", "sum"), AB=("타수", "sum"),
                               RBI=("타점", "sum"), R=("득점", "sum"),
                               G=("date", "nunique")).reset_index()
    pos = bat.groupby(key)["포지션"].apply(_primary_position).rename("position")
    out = agg.merge(ev_df, on=key, how="left").merge(pos, on=key, how="left")
    for c in ["B1", "B2", "B3", "HR", "uBB", "IBB", "HBP", "SF", "SH", "GDP", "BB"]:
        out[c] = out[c].fillna(0).astype(int)
    # PA and SO (SO unavailable from codes; leave 0 — unused by wOBA)
    out["PA"] = out["AB"] + out["BB"] + out["HBP"] + out["SF"] + out["SH"]
    out["SO"] = 0
    out["TB"] = out["B1"] + 2 * out["B2"] + 3 * out["B3"] + 4 * out["HR"]
    return out.rename(columns={"선수명": "name", "year": "season"})


def _load_raw_batter() -> pd.DataFrame:
    return pd.read_parquet(download()["batter.parquet"])


def batting(season: int, use_cache: bool = True) -> pd.DataFrame:
    """Full-roster batting lines for a season (canonical columns + position, franchise)."""
    cache = config.INTERIM_DIR / f"open_batting_{season}.parquet"
    if use_cache and cache.exists():
        return pd.read_parquet(cache)
    raw = _load_raw_batter()
    raw = raw[raw["year"] == season].copy()
    df = _decode_batting(raw)
    df["franchise"] = df["팀"].map(resolve_team)
    df = df[df["franchise"].notna() & (df["PA"] > 0)].drop(columns=["팀"]).reset_index(drop=True)
    df.to_parquet(cache, index=False)
    return df


# --------------------------------------------------------------------------- #
# Pitching: aggregate game-by-game -> season line.                            #
# --------------------------------------------------------------------------- #
def pitching(season: int, use_cache: bool = True) -> pd.DataFrame:
    """Full-staff pitching lines for a season (canonical columns, franchise, role)."""
    cache = config.INTERIM_DIR / f"open_pitching_{season}.parquet"
    if use_cache and cache.exists():
        return pd.read_parquet(cache)
    raw = pd.read_parquet(download()["pitcher.parquet"])
    raw = raw[raw["year"] == season].copy()
    raw["is_start"] = raw["포지션"].astype(str).str.contains("선발").astype(int)
    key = ["선수명", "팀"]
    g = raw.groupby(key).agg(
        outs=("이닝", "sum"), rest=("잔여이닝", "sum"),
        SO=("삼진", "sum"), BBHBP=("사사구", "sum"), HR=("피홈런", "sum"),
        R=("실점", "sum"), ER=("자책", "sum"), BF=("타자", "sum"),
        H=("피안타", "sum"), NP=("투구수", "sum"),
        W=("승", "sum"), L=("패", "sum"), SV=("세이브", "sum"), HLD=("홀드", "sum"),
        G=("date", "nunique"), GS=("is_start", "sum"),
    ).reset_index()
    # KBO parquet stores whole innings in 이닝 and leftover outs in 잔여이닝.
    g["IP"] = g["outs"] + g["rest"] / 3.0
    g["BB"] = g["BBHBP"]        # FIP uses (BB+HBP); the dump combines them as 사사구
    g["HBP"] = 0
    g["ERA"] = np.where(g["IP"] > 0, g["ER"] * 9.0 / g["IP"], np.nan)
    g["role"] = np.where(g["GS"] >= g["G"] * 0.5, "SP", "RP")
    g["franchise"] = g["팀"].map(resolve_team)
    g["season"] = season
    g = g[g["franchise"].notna() & (g["IP"] > 0)].rename(columns={"선수명": "name"})
    g = g.drop(columns=["팀", "outs", "rest", "BBHBP"]).reset_index(drop=True)
    g.to_parquet(cache, index=False)
    return g


def team_games(season: int) -> dict[str, int]:
    """Games each franchise actually played that season (from distinct game dates).

    Needed because the league changed size (8→9→10 teams) and 2020 is partial in the
    open dump (~97 g/team), so team-games can't be assumed to be 144.
    """
    raw = _load_raw_batter()
    raw = raw[raw["year"] == season].copy()
    raw["franchise"] = raw["팀"].map(resolve_team)
    return raw[raw["franchise"].notna()].groupby("franchise")["date"].nunique().to_dict()


def league_totals(season: int) -> dict:
    """League batting/pitching totals + team-games (for KBO constants, from the open dump)."""
    b, p = batting(season), pitching(season)
    tg = team_games(season)
    return {
        "bat": {c: float(b[c].sum()) for c in
                ["PA", "AB", "H", "B1", "B2", "B3", "HR", "BB", "IBB", "HBP", "SF", "R"]},
        "pit": {c: float(p[c].sum()) for c in ["IP", "ER", "HR", "BB", "HBP", "SO", "R", "BF"]},
        "team_games_total": int(sum(tg.values())),   # Σ per-team games = 2 × games played
        "n_teams": len(tg),
    }


def lg_r_per_g(season: int) -> float:
    """League runs per team per game — the game model's run-environment anchor."""
    lt = league_totals(season)
    return lt["bat"]["R"] / lt["team_games_total"]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    for yr in (2015, 2019):
        b, p = batting(yr, use_cache=False), pitching(yr, use_cache=False)
        print(f"{yr}: batters {len(b)} ({b['franchise'].nunique()} teams), pitchers {len(p)}")
        top = b.sort_values("HR", ascending=False).head(3)
        print("  HR leaders:", list(zip(top["name"], top["HR"], top["position"])))
