"""Project-wide constants. No logic here."""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
REVIEW_QUEUE_DIR = DATA_DIR / "review_queue"
MODELS_DIR = DATA_DIR / "models"

STATHEAD_RAW_DIR = RAW_DIR / "stathead"

for _d in (CACHE_DIR, RAW_DIR, INTERIM_DIR, REVIEW_QUEUE_DIR, MODELS_DIR, STATHEAD_RAW_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Scope: inbound-to-PL transfers from these source leagues, 2018/19 - 2023/24
TARGET_LEAGUE = "ENG-Premier League"
# soccerdata 1.8 FBref valid set: Big 5 + Big 5 Combined + INT competitions.
# Eredivisie and Primeira Liga are NOT available for FBref via soccerdata,
# so prior-season stats for players coming from those leagues are dropped.
# Coverage gap accepted for MVP.
SOURCE_LEAGUES = [
    "ENG-Premier League",
    "ESP-La Liga",
    "ITA-Serie A",
    "GER-Bundesliga",
    "FRA-Ligue 1",
]
SEASONS = ["2018-2019", "2019-2020", "2020-2021", "2021-2022", "2022-2023", "2023-2024"]

# Train: 2018/19 - 2021/22. Test: 2022/23 - 2023/24. Locked in eng-review Issue 1C.
TRAIN_SEASONS = ["2018-2019", "2019-2020", "2020-2021", "2021-2022"]
TEST_SEASONS = ["2022-2023", "2023-2024"]

# Sample-size floor. If filtered training set falls below this, escalate.
# Post-Issue-I2 pivot to Market Value labels: 1600+ PL players/season trivially
# clears 300, but we keep the gate for symmetry.
MIN_TRAIN_N = 300

# Edge-case filters (locked in design doc)
MIN_MINUTES_PRIOR_SEASON = 900
# (transfer-fee bonus filter no longer applies after Market Value pivot)

# Fuzzy match threshold for player ID layered match
FUZZY_MATCH_THRESHOLD = 90

# Reproducibility
RANDOM_SEED = 42
