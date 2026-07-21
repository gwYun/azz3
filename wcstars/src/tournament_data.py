"""2026 World Cup tournament signals: nation exposure (E) + per-player performance (P).

The breakout model needs two "spotlight" signals per player, kept PARALLEL (not
multiplied) so an individual breakout on an early-exit nation (e.g. Bouaddi /
Morocco) is not erased by a low nation-run score:

  E — nation exposure: how deep the player's nation went (champion > final > ...).
      Available for EVERY player via wc2026_results.json stage_reached/weights.

  P — individual tournament performance in [0,1]: assembled from the robots-clean
      FotMob "Top stats" overview (top-3 per category) + tournament awards, plus
      curated overrides for named breakouts FotMob's top-3 misses (Bouaddi, Kone).
      P = 0 for players who did not register on any FotMob leaderboard and are not
      curated — correct, since a player with no individual spotlight should not
      rank as a "breakout star" (he can still get a small lift from his nation's E).

Data provenance and the /api robots boundary are documented in the data files.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.data import _normalize_name  # noqa: E402

_DATA = Path(__file__).resolve().parents[1] / "data"

# FotMob nation strings -> the WC team names used in wc2026_results.json /
# worldcup groups. Only entries that differ from FotMob's spelling need mapping.
_FOTMOB_NATION_FIX = {
    "Cape Verde Islands": "Cape Verde",
    "Côte d'Ivoire": "Ivory Coast",
    "Bosnia and Herzegovina": "Bosnia-Herzegovina",
    "South Korea": "South Korea",
    "Turkey": "Turkiye",
    "USA": "United States",
    "United States": "United States",
}


def _norm1(name: str) -> str:
    return _normalize_name(pd.Series([name])).iloc[0]


# --------------------------------------------------------------------------- #
# Results / nation exposure (E)
# --------------------------------------------------------------------------- #
def load_results() -> dict:
    with open(_DATA / "wc2026_results.json") as f:
        return json.load(f)


def nation_exposure_map(results: dict | None = None) -> dict:
    """team name -> exposure weight in [0,1] (champion 1.0 ... group 0.12)."""
    results = results or load_results()
    stage_of = results["stage_reached"]
    weights = results["stage_weights"]
    default_w = weights[results.get("default_stage", "round_of_32")]
    out = {}
    for team, stage in stage_of.items():
        out[team] = float(weights.get(stage, default_w))
    out["_default"] = float(default_w)
    return out


# --------------------------------------------------------------------------- #
# Individual performance (P) from the FotMob top-stats overview
# --------------------------------------------------------------------------- #
# Which FotMob categories feed P, and the max used to normalize each to [0,1].
# The max is the rank-1 (leader) value present in the overview — an honest
# in-sample max, since the overview only exposes the top 3.
_PERF_CATEGORIES = {
    # category: weight in the composite
    "top_scorer": 0.34,
    "assists": 0.18,
    "goals_plus_assists": 0.16,
    "expected_goals_xg": 0.10,
    "expected_assists_xa": 0.08,
    "chances_created": 0.07,
    "successful_dribbles_per_90": 0.04,
}
# FotMob rating enters separately (baseline-shifted): a 6.7 avg maps to 0.
_RATING_BASELINE = 6.7
_RATING_WEIGHT = 0.13
# Award bonuses (added on top, then the whole P is clipped to [0,1]).
_AWARD_BONUS = {
    "golden_boot": 0.28, "golden_ball": 0.24, "young_player": 0.20,
    "silver_boot": 0.14, "bronze_boot": 0.10, "golden_glove": 0.10,
}


def _fotmob_perf_table() -> pd.DataFrame:
    """One row per FotMob-named player: normalized-name key, team, raw P components."""
    with open(_DATA / "wc2026_fotmob_topstats.json") as f:
        doc = json.load(f)
    cats = doc["categories"]

    # Per-category leader value = normalization max.
    cat_max = {c: max((e["value"] for e in cats[c]), default=1.0) for c in cats}

    # Accumulate per player.
    players: dict[str, dict] = {}

    def _touch(name, team):
        k = _norm1(name)
        if k not in players:
            players[k] = {"name": name, "team": team, "p_raw": 0.0,
                          "goals": 0.0, "assists": 0.0, "rating": 0.0}
        return players[k]

    for cat, weight in _PERF_CATEGORIES.items():
        for e in cats.get(cat, []):
            rec = _touch(e["name"], e["team"])
            norm = float(e["value"]) / cat_max[cat] if cat_max[cat] else 0.0
            rec["p_raw"] += weight * norm
            if cat == "top_scorer":
                rec["goals"] = float(e["value"])
            elif cat == "assists":
                rec["assists"] = float(e["value"])

    # Rating (baseline-shifted).
    rate = cats.get("fotmob_rating", [])
    rate_max = max((e["value"] for e in rate), default=_RATING_BASELINE + 1.0)
    denom = max(rate_max - _RATING_BASELINE, 0.1)
    for e in rate:
        rec = _touch(e["name"], e["team"])
        rec["rating"] = float(e["value"])
        rec["p_raw"] += _RATING_WEIGHT * max(float(e["value"]) - _RATING_BASELINE, 0.0) / denom

    # Awards.
    awards = doc.get("_awards", {})
    def _award_name(s):  # "Kylian Mbappé (France, 10)" -> "Kylian Mbappé"
        return s.split("(")[0].strip() if s else ""
    for key, bonus in _AWARD_BONUS.items():
        nm = _award_name(awards.get(key, ""))
        if nm:
            _touch(nm, "")["p_raw"] += bonus

    df = pd.DataFrame(players.values())
    df["_k"] = df["name"].map(_norm1)
    return df


def load_curated_perf() -> pd.DataFrame:
    """Named breakouts FotMob's top-3 misses, from historical_breakouts.actual_2026_movers.

    Gives each a solid P (they are, by definition, the tournament's talked-about
    risers) plus their reported jump for the report/validation. P is a curated
    floor: 0.72 for a confirmed record move, 0.66 for a strong rumor.
    """
    with open(_DATA / "historical_breakouts.json") as f:
        doc = json.load(f)
    rows = []
    for m in doc.get("actual_2026_movers", []):
        p = 0.72 if m.get("status") == "confirmed" else 0.64
        confirmed = m.get("status") == "confirmed"
        rows.append({
            "_k": _norm1(m["name"]), "name": m["name"], "p_curated": p,
            "reported_multiplier": float(m.get("implied_multiplier")
                                         or m.get("realized_multiplier") or 0.0),
            "mover_status": m.get("status", "rumored"),
            # Actual destination is known only for CONFIRMED moves; the output must
            # show reality for those, not the model's speculative best-fit club.
            "actual_club": m.get("to_club") if confirmed else None,
            "actual_fee_eur": float(m["transfer_fee_eur"]) if (confirmed and m.get("transfer_fee_eur")) else None,
        })
    return pd.DataFrame(rows)


def attach_signals(pool: pd.DataFrame, results: dict | None = None) -> pd.DataFrame:
    """Add columns E (nation exposure) and P (WC performance, [0,1]) to the pool.

    pool must have 'Player' (name) and 'team' (WC nation) columns — the shape
    returned by worldcup.src.squad_strength_v2.load_player_pool_2526().
    """
    results = results or load_results()
    pool = pool.copy()

    # E: nation exposure.
    emap = nation_exposure_map(results)
    default_e = emap["_default"]
    pool["E"] = pool["team"].map(lambda t: emap.get(t, default_e)).astype(float)

    # P: FotMob composite, clipped, then curated floor for named movers.
    pool["_k"] = _normalize_name(pool["Player"])
    fm = _fotmob_perf_table()[["_k", "p_raw", "goals", "assists", "rating"]]
    pool = pool.merge(fm, on="_k", how="left")
    pool["p_raw"] = pool["p_raw"].fillna(0.0).clip(0.0, 1.0)

    cur = load_curated_perf()
    if len(cur):
        pool = pool.merge(cur[["_k", "p_curated", "reported_multiplier", "mover_status",
                               "actual_club", "actual_fee_eur"]],
                          on="_k", how="left")
        pool["P"] = np.maximum(pool["p_raw"], pool["p_curated"].fillna(0.0))
    else:
        pool["P"] = pool["p_raw"]
        pool["reported_multiplier"] = np.nan
        pool["mover_status"] = np.nan
        pool["actual_club"] = None
        pool["actual_fee_eur"] = np.nan

    # WC goals/assists for the report (0 where unknown).
    pool["wc_goals"] = pool.get("goals", pd.Series(index=pool.index)).fillna(0.0)
    pool["wc_assists"] = pool.get("assists", pd.Series(index=pool.index)).fillna(0.0)
    pool["wc_rating"] = pool.get("rating", pd.Series(index=pool.index)).fillna(0.0)

    # Curated 2026 market value (jump baseline override), keyed by normalized name.
    mv = load_market_values_2026()
    pool["mv_2026"] = pool["_k"].map(mv).astype(float)
    return pool


def load_market_values_2026() -> dict:
    """Normalized-name -> curated pre-WC 2026 market value (EUR). Empty if file absent."""
    path = _DATA / "wc2026_market_values.json"
    if not path.exists():
        return {}
    with open(path) as f:
        vals = json.load(f).get("values", {})
    return {_norm1(k): float(v) for k, v in vals.items()}
