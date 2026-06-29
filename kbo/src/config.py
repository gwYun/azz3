"""KBO module constants. No logic here (mirrors src/config.py)."""
from __future__ import annotations

import json
from pathlib import Path

KBO_DIR = Path(__file__).resolve().parents[1]      # repo/kbo
PROJECT_ROOT = KBO_DIR.parent                       # repo root
DATA_DIR = KBO_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
OUTPUTS_DIR = KBO_DIR / "outputs"

for _d in (RAW_DIR, INTERIM_DIR, OUTPUTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# The KBO became a 10-team league in 2015 (kt wiz joined). Everything before that
# had 8-9 teams and a different run environment, so the model's calibration and
# projection windows are restricted to the 10-team era.
TEN_TEAM_ERA_START = 2015

# Season being forecast and the latest season with (partial or full) data. KBO
# seasons are single calendar years. Updated as the project rolls forward.
CURRENT_SEASON = 2026

# Projection looks back this many completed seasons (Marcel-style 3/2/1 weighting).
PROJECTION_LOOKBACK = 3

# Regular-season structure: 10 teams, 16 games vs each of the 9 opponents.
GAMES_VS_EACH_OPPONENT = 16
TEAMS = 10
GAMES_PER_TEAM = GAMES_VS_EACH_OPPONENT * (TEAMS - 1)   # 144
TOTAL_GAMES = GAMES_PER_TEAM * TEAMS // 2               # 720

RANDOM_SEED = 42

# Team metadata (franchise ids, ko/en names, KBO record-page codes, name aliases,
# home park) lives in a JSON sibling of this package so the web/report layers and
# the data normalizer share one source of truth.
TEAM_META_PATH = DATA_DIR / "kbo_team_meta.json"


def load_team_meta() -> dict:
    with open(TEAM_META_PATH, encoding="utf-8") as f:
        return json.load(f)
