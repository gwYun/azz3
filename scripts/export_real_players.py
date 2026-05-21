"""Export a curated set of real-player feature presets to web/public/players.json.

Reuses the enriched join pipeline from scripts/train.py so the features served
to the build-page dropdown match exactly what the model was trained on.

Curated allow-list of notable Premier-League transfers (2021–2022) — picked
because they're recognizable and span positions/ages. Players that don't join
cleanly (missing prior-season FBref row) are skipped with a log.
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import config  # noqa: E402
from scripts.predict import _load_artifacts, _prepare_feature_frame  # noqa: E402
from scripts.train import prepare_dataset  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("export_real_players")

CURATED_PLAYERS: list[tuple[str, int]] = [
    ("Diego Costa",          2014),
    ("Alexis Sánchez",       2014),
    ("Luke Shaw",            2014),
    ("Cesc Fàbregas",        2014),
    ("Ander Herrera",        2014),
    ("Roberto Firmino",      2015),
    ("Morgan Schneiderlin",  2015),
    ("Pedro",                2015),
    ("Henrikh Mkhitaryan",   2016),
    ("Juan Cuadrado",        2014),
    ("Cristiano Ronaldo",    2021),
    ("Dimitri Payet",        2015),
]


def main() -> int:
    art = _load_artifacts()
    joined = prepare_dataset()
    X_all = _prepare_feature_frame(art, joined)

    out: list[dict] = []
    seen: set[tuple[str, int]] = set()
    for name, season in CURATED_PLAYERS:
        mask = (joined["player_name"] == name) & (joined["season"].astype(int) == season)
        match_meta = joined[mask]
        match_X = X_all[mask]
        if match_meta.empty:
            log.warning("no join match for %s (%s) — skipping", name, season)
            continue
        # Pick the row with the most minutes (primary stats source if duped).
        order = match_meta["Mins_Per_90_Playing"].fillna(0).sort_values(ascending=False).index
        idx = order[0]
        row_meta = match_meta.loc[idx]
        row_X = match_X.loc[idx]
        key = (name, season)
        if key in seen:
            continue
        seen.add(key)

        feats = {f: float(row_X[f]) for f in art.features}
        out.append({
            "name": name,
            "season": int(season),
            "age": int(row_meta["player_age"]) if pd.notna(row_meta["player_age"]) else None,
            "position": str(row_meta.get("player_position", "")),
            "from_club": str(row_meta.get("club_2", "")),
            "to_club": str(row_meta.get("team_name", "")),
            "actual_fee_eur": float(row_meta["transfer_fee"]),
            "features": feats,
        })

    out_path = config.PROJECT_ROOT / "web" / "public" / "players.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    log.info("wrote %d players to %s", len(out), out_path.relative_to(config.PROJECT_ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
