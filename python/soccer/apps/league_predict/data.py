"""Read the Naver-sourced soccer tables from Supabase (service-role REST).

Credentials come from web/.env.local (NEXT_PUBLIC_SUPABASE_URL,
SUPABASE_SECRET_KEY) unless already in the environment. Pulls are cached as
parquet under python/data/cache/league_predict/ (gitignored); pass refresh=True
to re-pull after the cron has landed new results.
"""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

import pandas as pd

_ROOT = Path(__file__).resolve().parents[4]          # repo root
_ENV_FILE = _ROOT / "web" / ".env.local"
_CACHE = _ROOT / "python" / "data" / "cache" / "league_predict"

BIG5 = ["epl", "primera", "bundesliga", "seria", "ligue1"]


def _env() -> tuple[str, str]:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if (not url or not key) and _ENV_FILE.exists():
        for line in _ENV_FILE.read_text().splitlines():
            k, _, v = line.partition("=")
            v = v.strip().strip('"')
            if k == "NEXT_PUBLIC_SUPABASE_URL" and not url:
                url = v
            elif k == "SUPABASE_SECRET_KEY" and not key:
                key = v
    if not url or not key:
        raise SystemExit("Supabase URL / SUPABASE_SECRET_KEY not set (web/.env.local)")
    return url, key


def _fetch_all(table: str, query: str, page: int = 1000) -> list[dict]:
    url, key = _env()
    out: list[dict] = []
    off = 0
    while True:
        req = urllib.request.Request(
            f"{url}/rest/v1/{table}?{query}",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range": f"{off}-{off + page - 1}"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.load(r)
        out += rows
        if len(rows) < page:
            return out
        off += page


def _cached(name: str, pull, refresh: bool) -> pd.DataFrame:
    path = _CACHE / f"{name}.parquet"
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    df = pull()
    _CACHE.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return df


def load_games(refresh: bool = False) -> pd.DataFrame:
    """All big-5 games (played + scheduled), one row per match."""
    leagues = ",".join(BIG5)

    def pull():
        rows = _fetch_all(
            "soccer_games",
            "select=game_id,league,season,game_date,kickoff,status,home_team,away_team,"
            f"home_name,away_name,home_score,away_score&league=in.({leagues})&order=game_id",
        )
        return pd.DataFrame(rows)

    df = _cached("games", pull, refresh)
    df["game_date"] = pd.to_datetime(df["game_date"])
    return df


def load_players(refresh: bool = False) -> pd.DataFrame:
    """Player season rows (big-5, every season), flattened from the raw Naver row."""
    leagues = ",".join(BIG5)
    keep = ["playerId", "playerName", "dateOfBirth", "countryName", "position", "teamId",
            "matchesPlayed", "minsPlayed", "goals", "assists", "expectedGoals",
            "expectedAssists", "shots", "shotsOnTarget", "passes", "accuratePasses",
            "penaltyGoals", "redCards"]

    def pull():
        rows = _fetch_all(
            "soccer_player_stats",
            f"select=league,season,raw&league=in.({leagues})&order=league,season,player_id",
        )
        flat = [{"league": r["league"], "season": r["season"],
                 **{k: (r["raw"] or {}).get(k) for k in keep}} for r in rows]
        return pd.DataFrame(flat)

    return _cached("players", pull, refresh)
