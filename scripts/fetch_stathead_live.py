"""Fetch current-season FBref stats for a player from stathead (paid session required).

Usage:
    python scripts/fetch_stathead_live.py "Erling Haaland"
    python scripts/fetch_stathead_live.py "Bukayo Saka" --season 2025

Prerequisites:
    1. Run /setup-browser-cookies in Claude Code to import your logged-in browser
       cookies into the headless session, OR
    2. Set STATHEAD_SESSION_COOKIE env var to the value of your stathead session cookie.

The script searches the stathead player finder, scrapes the player's standard stats
row for the requested season, and writes a single-row CSV to:

    data/raw/stathead/live_<player_slug>_<season>.csv

This CSV is automatically picked up by load_stathead_stats() / load_fbref_all_stats()
on the next training run, and can also be fed directly to the /api/predict endpoint.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import config  # noqa: E402

STATHEAD_BASE = "https://www.sports-reference.com"
SEARCH_URL = f"{STATHEAD_BASE}/stathead/fbref/players/season-finder/"

# Stathead stat table slugs used in URL query params
_TABLE_SLUGS = {
    "standard": "stats_standard",
    "shooting": "stats_shooting",
    "passing": "stats_passing",
    "possession": "stats_possession",
    "defense": "stats_defense",
    "misc": "stats_misc",
}

_POLITE_DELAY = 2.0  # seconds between requests


def _get_session() -> requests.Session:
    """Build a requests session with stathead auth cookies."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; azz3-research-bot/1.0; personal paid account)",
        "Accept": "text/html,application/xhtml+xml",
        "Referer": STATHEAD_BASE,
    })
    # Accept session cookie from env var (copy from browser DevTools → Application → Cookies)
    cookie = os.environ.get("STATHEAD_SESSION_COOKIE")
    if cookie:
        # The cookie is the full cookie header string; parse name=value pairs
        for part in cookie.split(";"):
            if "=" in part:
                name, _, value = part.strip().partition("=")
                session.cookies.set(name.strip(), value.strip(), domain="www.sports-reference.com")
    else:
        # Try to load from the gstack browser cookie store if available
        cookie_file = Path.home() / ".claude" / "skills" / "gstack" / "browser_cookies.json"
        if cookie_file.exists():
            import json
            try:
                cookies = json.loads(cookie_file.read_text())
                for c in cookies:
                    if "sports-reference" in c.get("domain", ""):
                        session.cookies.set(c["name"], c["value"], domain=c["domain"])
            except Exception:
                pass
    return session


def _search_player(session: requests.Session, name: str, season: int) -> pd.DataFrame | None:
    """Query stathead player finder and return the matching stats row, or None."""
    params = {
        "request": 1,
        "match": "single_season",
        "year_min": season,
        "year_max": season,
        "comp_id": "",           # all competitions
        "order_by": "minutes",
        "order_by_asc": "",
        "player": name,
        "offset": 0,
    }
    try:
        resp = session.get(SEARCH_URL, params=params, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return None

    # Parse the HTML table
    try:
        tables = pd.read_html(resp.text)
    except ValueError:
        print("No tables found in response — are you logged in?", file=sys.stderr)
        return None

    if not tables:
        return None

    df = tables[0]
    # Stathead injects repeated header rows — drop them
    if "Player" in df.columns:
        df = df[df["Player"] != "Player"].copy()

    # Find the row matching the player name (fuzzy: contains)
    name_lower = name.lower()
    if "Player" in df.columns:
        mask = df["Player"].fillna("").str.lower().str.contains(name_lower.split()[-1], regex=False)
        df = df[mask]

    if df.empty:
        print(f"No results for '{name}' in season {season}", file=sys.stderr)
        return None

    # Take the row with the most minutes if multiple
    if "Min" in df.columns:
        df["Min"] = pd.to_numeric(df["Min"], errors="coerce")
        df = df.sort_values("Min", ascending=False)

    return df.head(1).copy()


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def fetch_player_season(name: str, season: int) -> Path | None:
    """Fetch a player's stats for a season and write CSV to the stathead raw dir.

    Returns the path to the written CSV, or None if the player was not found.
    """
    session = _get_session()
    print(f"Searching stathead for '{name}' season {season}...")
    row = _search_player(session, name, season)
    if row is None:
        return None

    # Add Season_End_Year so our ingestion pipeline can filter on it
    row = row.copy()
    row["Season_End_Year"] = season

    out_path = config.STATHEAD_RAW_DIR / f"fbref_standard_{_slug(name)}_{season}.csv"
    row.to_csv(out_path, index=False)
    print(f"Saved: {out_path} ({len(row)} row)")
    time.sleep(_POLITE_DELAY)
    return out_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch current-season FBref stats from stathead")
    parser.add_argument("player", help="Player name to search for")
    parser.add_argument("--season", type=int, default=2025, help="Season end year (default: 2025)")
    args = parser.parse_args()

    path = fetch_player_season(args.player, args.season)
    if path is None:
        print("Player not found or not logged in to stathead.", file=sys.stderr)
        sys.exit(1)
    print(f"Done. File written to: {path}")
