"""Data ingestion for the KBO models — legitimate public sources only.

Two sources, two distinct roles:

  * **KBO official /Record pages** (koreabaseball.com) — robots.txt permits `/Record/`.
    Server-rendered ASP.NET tables fetched via the standard `__VIEWSTATE` form-POST
    (echo every hidden field, set `ddlSeason`, send an `Origin` header). These give:
      - TEAM-season totals (all 10 teams in one page, no qualified-player filter — the
        reliable backbone for team ratings + league constants), and
      - QUALIFIED-player leaderboards (regulars, carrying every wOBA/wRC+/FIP input
        across the Basic1 + Basic2 tabs), paginated 30 hitters / 20 pitchers per page.

  * **choosunsick/KBO_data** (GitHub, open CSV) — game-by-game scores 2010-2019. Used
    only for the simulator's run environment / run-variance / home-field calibration,
    not for player stats.

We do NOT touch statiz.co.kr (its robots.txt forbids bots and names AI crawlers); the
advanced metrics (wOBA/wRC+/FIP/WAR) are computed in-house in `sabermetrics.py`.

Every fetch caches to parquet under kbo/data/interim and is skip-if-cached, so model
train/predict never hits the network — the same contract as src.data.load_stathead_2526.
"""
from __future__ import annotations

import html as ihtml
import io
import logging
import re
import time
import urllib.request
from pathlib import Path

import pandas as pd
import requests

from . import config

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Team-name resolution (franchise aliases).                                    #
# --------------------------------------------------------------------------- #
_META = config.load_team_meta()
TEAMS = _META["teams"]
TEAM_CODES = [t["code"] for t in TEAMS]
TEAM_KO = {t["code"]: t["ko"] for t in TEAMS}
TEAM_EN = {t["code"]: t["en"] for t in TEAMS}
TEAM_PARK = {t["code"]: t["park"] for t in TEAMS}

# alias (any spelling) -> franchise code
_ALIAS_TO_CODE: dict[str, str] = {}
for _t in TEAMS:
    _ALIAS_TO_CODE[_t["code"]] = _t["code"]
    _ALIAS_TO_CODE[_t["ko"]] = _t["code"]
    _ALIAS_TO_CODE[_t["en"]] = _t["code"]
    for _a in _t["aliases"]:
        _ALIAS_TO_CODE[_a] = _t["code"]


def resolve_team(raw) -> str | None:
    """Map any team-name spelling (KBO 팀명, game-log Korean, historical) to a code."""
    if not isinstance(raw, str):
        return None
    return _ALIAS_TO_CODE.get(raw.strip())


# --------------------------------------------------------------------------- #
# KBO official /Record client.                                                 #
# --------------------------------------------------------------------------- #
_RECORD_BASE = "https://www.koreabaseball.com"
# Every record control is nested under this naming prefix.
_PFX = "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$"
_SEASON_FIELD = _PFX + "ddlSeason$ddlSeason"
_TEAM_FIELD = _PFX + "ddlTeam$ddlTeam"
_HF_PAGE = _PFX + "hfPage"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Origin": _RECORD_BASE,  # KBO rejects the form-POST (custom error page) without this
}

# Record-page paths (relative to _RECORD_BASE).
_HITTER1 = "/Record/Player/HitterBasic/Basic1.aspx"
_HITTER2 = "/Record/Player/HitterBasic/Basic2.aspx"
_PITCHER1 = "/Record/Player/PitcherBasic/Basic1.aspx"
_PITCHER2 = "/Record/Player/PitcherBasic/Basic2.aspx"
_TEAM_HIT1 = "/Record/Team/Hitter/Basic1.aspx"
_TEAM_HIT2 = "/Record/Team/Hitter/Basic2.aspx"
_TEAM_PIT1 = "/Record/Team/Pitcher/Basic1.aspx"
_TEAM_PIT2 = "/Record/Team/Pitcher/Basic2.aspx"

_HIDDEN_RE = re.compile(r'<input[^>]*type="hidden"[^>]*>', re.I)
_NAME_RE = re.compile(r'name="([^"]*)"')
_VALUE_RE = re.compile(r'value="([^"]*)"')


class KBORecordClient:
    """Fetches KBO record tables via the ASP.NET viewstate form-POST.

    Stateless across calls except for the requests session (cookies). Each fetch
    GETs the page for a fresh viewstate, POSTs ddlSeason to switch season, then
    pages forward with hfPage. A small delay keeps the crawl polite.
    """

    def __init__(self, delay: float = 0.6):
        self.session = requests.Session()
        self.session.headers.update(_HEADERS)
        self.delay = delay

    def _get(self, url: str) -> str:
        r = self.session.get(url, timeout=30)
        r.encoding = "utf-8"
        return r.text

    def _post(self, url: str, src_html: str, event_target: str, **overrides) -> str:
        # Echo every hidden field from the source page (viewstate, eventvalidation,
        # hfOrderByCol/hfOrderBy, ...) exactly as a browser would, then override the
        # event target + selections. Blanking the sort fields trips a server error,
        # so they must be carried through.
        data: dict[str, str] = {}
        for tag in _HIDDEN_RE.findall(src_html):
            n = _NAME_RE.search(tag)
            if not n:
                continue
            v = _VALUE_RE.search(tag)
            data[n.group(1)] = ihtml.unescape(v.group(1)) if v else ""
        data["__EVENTTARGET"] = event_target
        data["__EVENTARGUMENT"] = ""
        data["__LASTFOCUS"] = ""
        data.update(overrides)
        time.sleep(self.delay)
        r = self.session.post(url, data=data, timeout=30)
        r.encoding = "utf-8"
        return r.text

    @staticmethod
    def _read_table(html: str) -> pd.DataFrame:
        tables = pd.read_html(io.StringIO(html))
        if not tables:
            raise ValueError("no table in KBO record response")
        return tables[0]

    def fetch_team_table(self, path: str, season: int) -> pd.DataFrame:
        """One page covering all 10 teams (+ a footer total row we drop later)."""
        url = _RECORD_BASE + path
        html0 = self._get(url)
        html = self._post(url, html0, _SEASON_FIELD,
                          **{_SEASON_FIELD: str(season), _TEAM_FIELD: ""})
        return self._read_table(html)

    def fetch_player_table(self, path: str, season: int) -> pd.DataFrame:
        """A season's qualified-player leaderboard (the ranking page's first page).

        The ranking lists only QUALIFIED players (규정타석/규정이닝) — ~30 batters /
        ~20 pitchers — and its "next page" control is client-side JavaScript
        (Paging-*.min.js), not a server postback, so there is no viewstate page-2 to
        fetch. This is sufficient for the player layer's role (a wRC+/WAR leaderboard
        of regulars + league-constant validation); the team model never depends on
        it, since team-season totals already cover every plate appearance. Pulling
        full benches would require the pager's AJAX endpoint and is deferred.
        """
        url = _RECORD_BASE + path
        html0 = self._get(url)
        html = self._post(url, html0, _SEASON_FIELD,
                          **{_SEASON_FIELD: str(season), _TEAM_FIELD: ""})
        return self._read_table(html).drop_duplicates(["선수명", "팀명"])


# --------------------------------------------------------------------------- #
# Canonical column maps + parsing helpers.                                     #
# --------------------------------------------------------------------------- #
# Korean header -> canonical English. Applied after merging the Basic1/Basic2 tabs.
_BAT_RENAME = {
    "선수명": "name", "팀명": "team_raw", "AVG": "AVG", "G": "G", "PA": "PA",
    "AB": "AB", "R": "R", "H": "H", "2B": "B2", "3B": "B3", "HR": "HR",
    "TB": "TB", "RBI": "RBI", "SAC": "SAC", "SF": "SF", "BB": "BB", "IBB": "IBB",
    "HBP": "HBP", "SO": "SO", "GDP": "GDP", "SLG": "SLG", "OBP": "OBP", "OPS": "OPS",
}
_PIT_RENAME = {
    "선수명": "name", "팀명": "team_raw", "ERA": "ERA", "G": "G", "W": "W", "L": "L",
    "SV": "SV", "HLD": "HLD", "IP": "IP_raw", "H": "H", "HR": "HR", "BB": "BB",
    "HBP": "HBP", "SO": "SO", "R": "R", "ER": "ER", "WHIP": "WHIP", "TBF": "TBF",
}
_BAT_NUM = ["G", "PA", "AB", "R", "H", "B2", "B3", "HR", "TB", "RBI", "SAC", "SF",
            "BB", "IBB", "HBP", "SO", "GDP", "AVG", "SLG", "OBP", "OPS"]
_PIT_NUM = ["G", "W", "L", "SV", "HLD", "H", "HR", "BB", "HBP", "SO", "R", "ER",
            "ERA", "WHIP", "TBF"]


def _parse_ip(s) -> float:
    """KBO innings-pitched: '690 2/3' -> 690.667, '93 1/3' -> 93.333, '675' -> 675."""
    if pd.isna(s):
        return float("nan")
    txt = str(s).strip()
    if not txt:
        return float("nan")
    whole, frac = 0.0, 0.0
    parts = txt.split()
    for p in parts:
        if "/" in p:
            num, den = p.split("/")
            frac = float(num) / float(den)
        else:
            whole = float(p)
    return whole + frac


def _merge_tabs(t1: pd.DataFrame, t2: pd.DataFrame, keys=("선수명", "팀명")) -> pd.DataFrame:
    """Merge Basic1 + Basic2, keeping Basic1's shared columns (AVG, etc.)."""
    drop = [c for c in t2.columns if c in t1.columns and c not in keys]
    return t1.merge(t2.drop(columns=drop), on=list(keys), how="left")


def _finalize(df: pd.DataFrame, rename: dict, num_cols: list[str],
              season: int, is_pitcher: bool) -> pd.DataFrame:
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    df["franchise"] = df["team_raw"].map(resolve_team)
    df = df[df["franchise"].notna()].copy()      # drops footer/total + unknown rows
    df["season"] = season
    if is_pitcher:
        df["IP"] = df["IP_raw"].map(_parse_ip)
    for c in num_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    if not is_pitcher and {"H", "B2", "B3", "HR"}.issubset(df.columns):
        df["B1"] = df["H"] - df["B2"] - df["B3"] - df["HR"]   # singles
    return df.reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Public loaders (cached).                                                     #
# --------------------------------------------------------------------------- #
def _cache(name: str) -> Path:
    return config.INTERIM_DIR / name


def _client() -> KBORecordClient:
    return KBORecordClient()


def team_batting(season: int, use_cache: bool = True, client: KBORecordClient | None = None) -> pd.DataFrame:
    """One row per franchise: season batting totals (canonical columns)."""
    cache = _cache(f"team_batting_{season}.parquet")
    if use_cache and cache.exists():
        return pd.read_parquet(cache)
    c = client or _client()
    df = _merge_tabs(c.fetch_team_table(_TEAM_HIT1, season),
                     c.fetch_team_table(_TEAM_HIT2, season), keys=("팀명",))
    df = _finalize(df, _BAT_RENAME, _BAT_NUM, season, is_pitcher=False)
    df.to_parquet(cache, index=False)
    return df


def team_pitching(season: int, use_cache: bool = True, client: KBORecordClient | None = None) -> pd.DataFrame:
    cache = _cache(f"team_pitching_{season}.parquet")
    if use_cache and cache.exists():
        return pd.read_parquet(cache)
    c = client or _client()
    df = _merge_tabs(c.fetch_team_table(_TEAM_PIT1, season),
                     c.fetch_team_table(_TEAM_PIT2, season), keys=("팀명",))
    df = _finalize(df, _PIT_RENAME, _PIT_NUM, season, is_pitcher=True)
    df.to_parquet(cache, index=False)
    return df


def player_batting(season: int, use_cache: bool = True, client: KBORecordClient | None = None) -> pd.DataFrame:
    """Qualified batters for a season (regulars), canonical columns + franchise."""
    cache = _cache(f"player_batting_{season}.parquet")
    if use_cache and cache.exists():
        return pd.read_parquet(cache)
    c = client or _client()
    df = _merge_tabs(c.fetch_player_table(_HITTER1, season),
                     c.fetch_player_table(_HITTER2, season))
    df = _finalize(df, _BAT_RENAME, _BAT_NUM, season, is_pitcher=False)
    df.to_parquet(cache, index=False)
    return df


def player_pitching(season: int, use_cache: bool = True, client: KBORecordClient | None = None) -> pd.DataFrame:
    cache = _cache(f"player_pitching_{season}.parquet")
    if use_cache and cache.exists():
        return pd.read_parquet(cache)
    c = client or _client()
    df = _merge_tabs(c.fetch_player_table(_PITCHER1, season),
                     c.fetch_player_table(_PITCHER2, season))
    df = _finalize(df, _PIT_RENAME, _PIT_NUM, season, is_pitcher=True)
    df.to_parquet(cache, index=False)
    return df


# --------------------------------------------------------------------------- #
# choosunsick/KBO_data game results (open CSV; simulator calibration only).    #
# --------------------------------------------------------------------------- #
_GAME_BASE_URL = "https://raw.githubusercontent.com/choosunsick/KBO_data/master/Data"
_GAME_DIR = config.RAW_DIR / "kbo_games"
# Markers in the 비고 (note) column that are NOT regular-season games.
_NON_REGULAR = ("시범", "포스트", "와일드", "준플레이오프", "플레이오프", "한국시리즈", "올스타")


def download_game_results(force: bool = False) -> list[Path]:
    """Download (skip-if-cached) the per-season game-log CSVs (2010-2019)."""
    _GAME_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for year in range(2010, 2020):
        fname = f"KBO_{year}_season.csv"
        dest = _GAME_DIR / fname
        if not dest.exists() or force:
            url = f"{_GAME_BASE_URL}/{fname}"
            log.info("Downloading %s ...", url)
            urllib.request.urlretrieve(url, dest)
        out.append(dest)
    return out


def load_game_results(seasons: list[int] | None = None, regular_only: bool = True) -> pd.DataFrame:
    """Normalized per-game scores: season, date, park, away/home franchise + score.

    `seasons` filters by calendar year. `regular_only` drops preseason/postseason/
    all-star rows (by the 비고 note). Teams resolve to franchise codes via the alias
    map, so 넥센/SK historical names map onto 키움/SSG.
    """
    paths = download_game_results()
    frames = []
    for p in paths:
        raw = pd.read_csv(p)
        frames.append(raw)
    df = pd.concat(frames, ignore_index=True)

    out = pd.DataFrame()
    out["date"] = pd.to_datetime(df["Date"], errors="coerce")
    out["season"] = out["date"].dt.year
    out["park"] = df["구장"].astype(str)
    out["away_franchise"] = df["원정팀"].map(resolve_team)
    out["home_franchise"] = df["홈팀"].map(resolve_team)
    out["away_score"] = pd.to_numeric(df["원정팀점수"], errors="coerce")
    out["home_score"] = pd.to_numeric(df["홈팀점수"], errors="coerce")
    out["note"] = df["비고"].astype(str).fillna("")

    if regular_only:
        mask = ~out["note"].str.contains("|".join(_NON_REGULAR), na=False)
        out = out[mask]
    out = out[out["away_franchise"].notna() & out["home_franchise"].notna()]
    out = out[out["away_score"].notna() & out["home_score"].notna()]
    if seasons is not None:
        out = out[out["season"].isin(seasons)]
    return out.reset_index(drop=True)


if __name__ == "__main__":   # quick manual smoke test
    logging.basicConfig(level=logging.INFO)
    tb = team_batting(config.CURRENT_SEASON, use_cache=False)
    print("team_batting:", tb.shape, tb[["franchise", "G", "PA", "R", "H", "HR", "BB"]].head())
    g = load_game_results(seasons=[2018])
    print("games 2018:", g.shape, g.head(3).to_string())
