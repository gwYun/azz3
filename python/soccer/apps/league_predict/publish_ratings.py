"""Publish pre-season club value ratings to Supabase (soccer_club_ratings).

Run once per season (after the summer window) — and any time the value chain
changes. Writes every league-season the chain covers, because the daily TS
model fits on past seasons too and needs each game's own-season rating.

Usage (from python/):
  ../.venv/bin/python -m soccer.apps.league_predict.publish_ratings [--refresh]
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.request

from .club_value import club_ratings
from .data import _env, load_players


def _commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def main():
    refresh = "--refresh" in sys.argv
    ratings = club_ratings(load_players(refresh=refresh))
    commit = _commit()
    rows = [{
        "league": r.league, "season": int(r.season), "team_code": r.team,
        "rating": round(float(r.rating), 4), "strength": round(float(r.strength), 1),
        "synergy_mult": round(float(r.synergy_mult), 4),
        "known_share": round(float(r.known_share), 3), "model_commit": commit,
    } for r in ratings.itertuples()]

    url, key = _env()
    req = urllib.request.Request(
        f"{url}/rest/v1/soccer_club_ratings?on_conflict=league,season,team_code",
        data=json.dumps(rows).encode(),
        method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f"upserted {len(rows)} club ratings (HTTP {r.status}, commit {commit})")
    print(ratings.groupby(["league", "season"]).size().unstack())


if __name__ == "__main__":
    main()
