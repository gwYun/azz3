"""KBO game-by-game results from Naver Sports' schedule API (live/current-season log).

Why this source: the historical game log this project used (choosunsick/KBO_data) ends
at the 2018 All-Star break, and the KBO official site now blocks all crawlers
(robots.txt: `User-agent: * / Disallow: /` + a "사전 승인 없이 자동 수집 금지" notice).
Naver's schedule API *gateway* (api-gw.sports.naver.com) carries no robots.txt
restriction and returns clean per-game JSON whose team codes are the SAME franchise
codes this project already uses (SK, HH, HT, KT, NC, ...), so it maps ~1:1 onto the
existing game-log schema in `data.load_game_results`.

Politeness: results are fetched ONE calendar month per request, with a configurable
delay between requests (default 3s), and every month is cached to disk so a re-run
never re-hits the network. Undocumented internal API — kept to a light, spaced crawl.
"""
from __future__ import annotations

import calendar
import json
import logging
import time
from pathlib import Path

import pandas as pd
import requests

from . import config, data as kbo_data

log = logging.getLogger(__name__)

_API = "https://api-gw.sports.naver.com/schedule/games"
_HEADERS = {
    # A browser-ish UA is not strictly required (bare requests work), but it keeps the
    # crawl honest about what it is and is friendlier to the gateway.
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Referer": "https://m.sports.naver.com/",
}
# Where per-month raw JSON is cached (skip-if-cached).
_RAW_DIR = config.RAW_DIR / "naver_games"

# statusCode values seen: RESULT (played, has score), BEFORE (scheduled), CANCEL.
_PLAYED = "RESULT"


class NaverKBOClient:
    """Fetches KBO schedule/results a month at a time, politely spaced + cached."""

    def __init__(self, delay: float = 3.0):
        self.session = requests.Session()
        self.session.headers.update(_HEADERS)
        self.delay = delay
        _RAW_DIR.mkdir(parents=True, exist_ok=True)

    def _month_cache(self, year: int, month: int) -> Path:
        return _RAW_DIR / f"kbo_{year}-{month:02d}.json"

    def fetch_month(self, year: int, month: int, use_cache: bool = True) -> list[dict]:
        """All KBO games in one calendar month. Cached raw; one spaced request on miss."""
        cache = self._month_cache(year, month)
        if use_cache and cache.exists():
            return json.loads(cache.read_text(encoding="utf-8"))

        last = calendar.monthrange(year, month)[1]
        params = {
            "upperCategoryId": "kbaseball",
            "categoryId": "kbo",
            "fromDate": f"{year}-{month:02d}-01",
            "toDate": f"{year}-{month:02d}-{last:02d}",
            "fields": "basic,stadium",
            # The API defaults to a 10-row page; `size` lifts the cap. A KBO month is
            # ~150 games max, so 500 always covers a full month in one request.
            "size": 500,
        }
        time.sleep(self.delay)  # space every network request
        r = self.session.get(_API, params=params, timeout=30)
        r.raise_for_status()
        res = r.json().get("result", {}) or {}
        games = res.get("games", []) or []
        total = res.get("gameTotalCount", len(games))
        if total > len(games):  # would need paging; shouldn't happen at size=500
            log.warning("naver %d-%02d: got %d of %d games (truncated)",
                        year, month, len(games), total)
        cache.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")
        log.info("naver %d-%02d: %d games", year, month, len(games))
        return games


# --------------------------------------------------------------------------- #
# Normalization to the canonical game-log schema (matches data.load_game_results).
# --------------------------------------------------------------------------- #
def _normalize(games: list[dict]) -> pd.DataFrame:
    """Naver game dicts -> season, date, park, away/home franchise + score, status, note.

    Team assignment uses homeTeamCode/awayTeamCode directly (the canonical home/away);
    `reversedHomeAway` only affects Naver's own display order, not the codes. Codes
    already equal this project's franchise ids, but they're passed through `resolve_team`
    so any team-name spelling would also resolve.
    """
    rows = []
    for g in games:
        rows.append({
            "date": g.get("gameDate"),
            "gameId": g.get("gameId"),
            "park": g.get("stadium"),
            "away_franchise": kbo_data.resolve_team(g.get("awayTeamCode") or g.get("awayTeamName")),
            "home_franchise": kbo_data.resolve_team(g.get("homeTeamCode") or g.get("homeTeamName")),
            "away_score": g.get("awayTeamScore"),
            "home_score": g.get("homeTeamScore"),
            "status": g.get("statusCode"),
            "cancel": bool(g.get("cancel")),
            "suspended": bool(g.get("suspended")),
        })
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["season"] = df["date"].dt.year
    for c in ("away_score", "home_score"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def collect_season(season: int, months: range | list[int] | None = None,
                   use_cache: bool = True, delay: float = 3.0,
                   client: NaverKBOClient | None = None) -> pd.DataFrame:
    """Collect one season's KBO games from Naver (spaced, cached), normalized.

    `months` defaults to the KBO window (Mar–Nov); empty months cost one request each
    but are skipped in the result. Returns ALL games (played + scheduled) with a
    `status` column; filter to status == 'RESULT' for the completed-game log.
    """
    c = client or NaverKBOClient(delay=delay)
    months = months if months is not None else range(3, 12)  # Mar..Nov
    frames = []
    for m in months:
        games = c.fetch_month(season, m, use_cache=use_cache)
        if games:
            frames.append(_normalize(games))
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df = df[df["away_franchise"].notna() & df["home_franchise"].notna()]
    return df.sort_values("date").reset_index(drop=True)


def played_games(df: pd.DataFrame) -> pd.DataFrame:
    """Only completed games that carry a real score (drops BEFORE/CANCEL/suspended)."""
    if df.empty:
        return df
    m = (df["status"] == _PLAYED) & (~df["cancel"]) & (~df["suspended"])
    m &= df["away_score"].notna() & df["home_score"].notna()
    return df[m].reset_index(drop=True)
