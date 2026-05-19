"""Export a curated set of real-player feature presets to web/public/players.json.

Reuses the same join pipeline as scripts/predict.py so the 15 features served
to the build-page dropdown match exactly what the model was trained on.

Curated allow-list of notable Premier-League transfers (2021–2022) — picked
because they're recognizable to the audience and span positions/ages. Players
that don't join cleanly (missing prior-season FBref row) are skipped with a log.
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import config  # noqa: E402
from src.data import (  # noqa: E402
    join_transfers_with_prior_season_stats,
    load_fbref_player_stats,
    load_transfers,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("export_real_players")

# (player_name, season) tuples — season matches the `season` column in big5_transfers.rds.
CURATED_PLAYERS: list[tuple[str, int]] = [
    ("Jack Grealish", 2021),
    ("Romelu Lukaku", 2021),
    ("Jadon Sancho", 2021),
    ("Wesley Fofana", 2022),
    ("Casemiro", 2022),
    ("Alexander Isak", 2022),
    ("Erling Haaland", 2022),
    ("Marc Cucurella", 2022),
    ("Ben White", 2021),
    ("Raheem Sterling", 2022),
    ("Gabriel Jesus", 2022),
    ("Richarlison", 2022),
]


def _load_features() -> tuple[list[str], dict[str, float]]:
    with open(config.MODELS_DIR / "selected_features.json") as f:
        meta = json.load(f)
    return meta["features"], meta["medians"]


def main() -> int:
    features, medians = _load_features()
    medians_series = pd.Series(medians)

    seasons = list(range(2014, 2023))
    transfers = load_transfers(seasons=seasons)
    stats = load_fbref_player_stats(seasons=seasons + [s + 1 for s in seasons])
    joined = join_transfers_with_prior_season_stats(transfers, stats, age_tolerance=2)
    joined[features] = joined[features].fillna(medians_series)

    out: list[dict] = []
    seen: set[tuple[str, int]] = set()
    for name, season in CURATED_PLAYERS:
        match = joined[
            (joined["player_name"] == name) & (joined["season"].astype(int) == season)
        ]
        if match.empty:
            log.warning("no join match for %s (%s) — skipping", name, season)
            continue
        # Some players (e.g. Cucurella) end up duplicated by the name+age join.
        # Pick the row with the most minutes played — the buyer's primary stats source.
        row = match.sort_values("Mins_Per_90_Playing", ascending=False).iloc[0]
        key = (name, season)
        if key in seen:
            continue
        seen.add(key)

        feats = {f: float(row[f]) for f in features}
        out.append({
            "name": name,
            "season": int(season),
            "age": int(row["player_age"]) if pd.notna(row["player_age"]) else None,
            "position": str(row.get("player_position", "")),
            "from_club": str(row.get("club_2", "")),
            "to_club": str(row.get("team_name", "")),
            "actual_fee_eur": float(row["transfer_fee"]),
            "features": feats,
        })

    out_path = config.PROJECT_ROOT / "web" / "public" / "players.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    log.info("wrote %d players to %s", len(out), out_path.relative_to(config.PROJECT_ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
