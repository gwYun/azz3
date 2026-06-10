"""(C) Hybrid destination recommender: club-fit engine x league prior x shortlist.

Composes club_profiles (A) with two realism layers:
  - dest_league_prior: empirical recency-weighted share of inbound transfers per
    destination league (5 dense classes) — a soft multiplier, NOT a trained model.
  - suitor shortlist: a curated whitelist of clubs plausibly active in July 2026.

The fee is predicted ONCE per player (destination-agnostic by model design). The
displayed fee is a RANGE shaped by the chosen club's typical spend — the model
point estimate is preserved; only the band is club-specific.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve()
_PROJECT_ROOT = _HERE.parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from destination.src import club_profiles as cp  # noqa: E402
from destination.src import fee_bridge as fb  # noqa: E402

_DATA = _HERE.parents[1] / "data"


def load_suitor_shortlist() -> tuple[list, dict, dict]:
    with open(_DATA / "suitor_clubs_2026.json") as f:
        d = json.load(f)
    return d["clubs"], d.get("ko_names", {}), d.get("prestige", {})


# How strongly prestige bends the ranking. A club's effective score is multiplied
# by prestige**PRESTIGE_EXP, so 0 = ignore prestige, higher = stronger pull toward
# the most prestigious clubs. Set so prestige is decisive among the elite buyers
# (otherwise whichever club has the single highest historical spend, Man Utd, wins
# every marquee player) while affordability/fit still gate out clubs that can't pay.
PRESTIGE_EXP = 1.6


def dest_league_prior(df: pd.DataFrame, recency_halflife: float = 3.0) -> dict:
    """Soft destination-league prior, normalized to max=1.

    Based on recency-weighted inbound volume but heavily compressed (4th root) so
    a league is only a gentle tie-breaker — raw transfer *volume* should not let a
    high-churn league (Serie A) dominate prestige. The square/4th-root pulls all
    five Big-5 leagues into a narrow [~0.8, 1.0] band.
    """
    df = df.copy()
    df["_w"] = cp._recency_weight(df["season"], recency_halflife)
    share = df.groupby("league")["_w"].sum()
    share = (share / share.max()) ** 0.25
    return {str(k): float(v) for k, v in share.items()}


# Confidence band as a fraction of the per-club point estimate. The buyer effect
# now lives IN the model (per-club point fee), so the band is just a modest
# uncertainty interval, not a club-spend reshaping.
_FEE_BAND_FRAC = 0.18


def fee_range_eur(point_eur: float) -> tuple[float, float]:
    """Symmetric uncertainty band around a per-club point fee."""
    return float(point_eur * (1.0 - _FEE_BAND_FRAC)), float(point_eur * (1.0 + _FEE_BAND_FRAC))


def recommend(player: dict, stat_row, profiles: dict, league_prior: dict,
              shortlist: list, art, top_k: int = 5, prestige: dict | None = None) -> pd.DataFrame:
    """Rank destination clubs for one player; predict a buyer-aware fee per club."""
    # Neutral (average-paying club) fee, for reference / fallback. Pass `art` so
    # the market value is deflated to the model's 2014-€ scale (dest_club=None
    # keeps the buyer interaction neutral).
    X0 = fb.player_to_model_row(player, stat_row, art=art, dest_club=None)
    neutral_eur = float(fb.predict_fee_eur(art, X0)[0])

    # Candidate clubs = shortlist ∩ profiles, excluding the player's own club.
    shortlist_set = set(shortlist) - {player["current_club"]}
    candidates = [c for c in shortlist_set if c in profiles]
    shortlisted = True
    if len(candidates) < top_k:
        candidates = [c for c in profiles if c != player["current_club"]]
        shortlisted = False

    # Score each candidate: club fit x league prior x prestige; fee is buyer-aware.
    prestige = prestige or {}
    rows = []
    for c in candidates:
        club = profiles[c]
        # Buyer-aware fee: re-run the model with this club's premium interaction.
        Xc = fb.player_to_model_row(player, stat_row, art=art, dest_club=c)
        point_eur = float(fb.predict_fee_eur(art, Xc)[0])

        fit = cp.score_player_against_club(player, club, point_eur)
        lp = league_prior.get(club.dest_league, 0.5)
        prest = prestige.get(c, 0.6) ** PRESTIGE_EXP
        score = fit * lp * prest
        low, high = fee_range_eur(point_eur)
        rows.append({
            "to_club": c,
            "dest_league": club.dest_league,
            "fit_score": round(score, 4),
            "predicted_fee_eur": point_eur,
            "fee_low_eur": low,
            "fee_high_eur": high,
            "neutral_fee_eur": neutral_eur,
            "buyer_premium": round(art.buyer_premium_map.get(c, art.buyer_premium_default), 3),
            "club_fee_median_eur": club.fee_median_eur,
            "shortlisted": shortlisted,
        })

    out = pd.DataFrame(rows).sort_values("fit_score", ascending=False).head(top_k)
    out.insert(0, "rank", range(1, len(out) + 1))
    return out.reset_index(drop=True)
