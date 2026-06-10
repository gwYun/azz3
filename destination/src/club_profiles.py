"""(A) Empirical club buying-profile engine.

The fee model has no destination feature, so "where does this player go?" is
answered NOT by the model but by what each Big-5 club has historically bought.
We build one buying profile per destination club from the disclosed-fee transfer
history (src.data.load_transfers, 2014-2022) and score a candidate player against
each profile. No new ML training — every signal is a transparent aggregate.

Recency weighting (exponential decay on season) keeps 2021-2022 buys more
relevant than 2014 ones, which is the cheapest available correction toward the
2026 window.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.data import load_transfers  # noqa: E402
from src.enrich import FeeDeflator  # noqa: E402

# Most recent transfer season in the data; recency weight decays from here.
_REF_SEASON = 2022
POS_GROUPS = ("forward", "midfielder", "defender")

# Transfermarkt-style position strings (as in load_transfers' player_position)
# -> our forward/midfielder/defender groups. The FBref-oriented
# features.assign_position_group only knows short codes (FW, MF), so it maps
# these long names to "unknown"; this table is the transfer-side equivalent.
_TM_POS_GROUP = {
    "Goalkeeper": "goalkeeper",
    "Centre-Back": "defender", "Left-Back": "defender", "Right-Back": "defender", "Defender": "defender",
    "Defensive Midfield": "midfielder", "Central Midfield": "midfielder", "Attacking Midfield": "midfielder",
    "Left Midfield": "midfielder", "Right Midfield": "midfielder", "Midfielder": "midfielder", "midfield": "midfielder",
    "Centre-Forward": "forward", "Left Winger": "forward", "Right Winger": "forward",
    "Second Striker": "forward", "Forward": "forward", "attack": "forward",
}


def _tm_position_group(pos: str) -> str:
    if not isinstance(pos, str):
        return "unknown"
    return _TM_POS_GROUP.get(pos.strip(), "unknown")

# Score weights (documented, tunable) — how much each fit signal contributes.
# Fee-band dominates: a club that has never spent near a player's value is a poor
# destination no matter how many cheap players of his position it churns. Volume
# is deliberately small so high-churn mid-table clubs don't outrank elite buyers.
W_POSITION = 0.18
W_NATIONALITY = 0.10
W_SOURCE_LEAGUE = 0.10
W_AGE = 0.10
W_FEE_BAND = 0.45
W_VOLUME = 0.07


@dataclass
class ClubProfile:
    club: str
    dest_league: str
    n_inbound: float                 # recency-weighted count
    fee_mean_eur: float              # deflated to a common scale
    fee_median_eur: float
    fee_iqr_eur: float
    pos_mix: dict = field(default_factory=dict)          # group -> weighted share
    nat_counts: dict = field(default_factory=dict)       # nationality -> weighted count
    source_league_counts: dict = field(default_factory=dict)
    age_mean: float = 26.0
    age_std: float = 4.0


def build_profile_frame() -> pd.DataFrame:
    """Raw destination-side transfer rows (no FBref join -> max club coverage)."""
    df = load_transfers(seasons=list(range(2014, 2023)))
    df = df[df["team_name"].notna() & (df["team_name"].astype(str) != "")].copy()
    df["season"] = pd.to_numeric(df["season"], errors="coerce")
    df["transfer_fee"] = pd.to_numeric(df["transfer_fee"], errors="coerce")
    df["player_age"] = pd.to_numeric(df["player_age"], errors="coerce")
    df["pos_group"] = df["player_position"].map(_tm_position_group)
    return df.reset_index(drop=True)


def _recency_weight(season: pd.Series, halflife: float) -> pd.Series:
    age = (_REF_SEASON - season).clip(lower=0)
    return np.power(0.5, age / halflife)


def fit_profiles(df: pd.DataFrame, deflator: FeeDeflator, recency_halflife: float = 3.0) -> dict:
    """One ClubProfile per destination club, recency- and inflation-adjusted."""
    df = df.copy()
    df["_w"] = _recency_weight(df["season"], recency_halflife)
    # Deflate fees to a common (2014-baseline) scale so a club's historical
    # spend level is comparable across seasons.
    df["_fee_defl"] = deflator.deflate(df["transfer_fee"], df["season"])

    profiles: dict = {}
    for club, sub in df.groupby("team_name"):
        w = sub["_w"]
        fees = sub["_fee_defl"].dropna()
        if len(fees):
            q1, q3 = fees.quantile(0.25), fees.quantile(0.75)
            fee_mean = float(np.average(fees, weights=w.loc[fees.index])) if w.loc[fees.index].sum() else float(fees.mean())
        else:
            q1 = q3 = fee_mean = 0.0

        pos_mix = {}
        for g in POS_GROUPS:
            mask = sub["pos_group"] == g
            pos_mix[g] = float(w[mask].sum() / w.sum()) if w.sum() else 0.0

        nat = sub.groupby("player_nationality")["_w"].sum().to_dict()
        src = sub.groupby("league_2")["_w"].sum().to_dict()

        ages = sub["player_age"].dropna()
        profiles[club] = ClubProfile(
            club=str(club),
            dest_league=str(sub["league"].mode().iloc[0]) if len(sub["league"].mode()) else "",
            n_inbound=float(w.sum()),
            fee_mean_eur=float(fee_mean),
            fee_median_eur=float(fees.median()) if len(fees) else 0.0,
            fee_iqr_eur=float(q3 - q1),
            pos_mix=pos_mix,
            nat_counts={str(k): float(v) for k, v in nat.items()},
            source_league_counts={str(k): float(v) for k, v in src.items()},
            age_mean=float(ages.mean()) if len(ages) else 26.0,
            age_std=float(ages.std()) if len(ages) > 1 else 4.0,
        )
    return profiles


def _laplace_share(counts: dict, key: str, total: float, alpha: float = 0.5) -> float:
    """Smoothed share of `key` in a weighted count dict (avoids hard zeros)."""
    n_keys = max(len(counts), 1)
    return (counts.get(key, 0.0) + alpha) / (total + alpha * n_keys)


def score_player_against_club(player: dict, club: ClubProfile, predicted_fee_eur: float) -> float:
    """Transparent weighted fit score in [0, ~1]. Higher = better historical fit."""
    pos = player["position_group"]
    pos_fit = club.pos_mix.get(pos, 0.0)

    nat_total = sum(club.nat_counts.values())
    nat_fit = _laplace_share(club.nat_counts, player["nationality"], nat_total)

    src_total = sum(club.source_league_counts.values())
    src_fit = _laplace_share(club.source_league_counts, player["current_league"], src_total)

    age_std = max(club.age_std, 1.0)
    age_fit = float(np.exp(-0.5 * ((player["age"] - club.age_mean) / age_std) ** 2))

    # Fee-band plausibility: can this club AFFORD the player? One-sided — spending
    # at or above the player's value is fine (elite clubs always can); spending far
    # below is strongly penalized. We compare against the club's upper spend (median
    # + half-IQR) so a club's top-end deals, not its median bargain, set the ceiling.
    club_ceiling = club.fee_median_eur + 0.5 * club.fee_iqr_eur
    if club_ceiling > 0:
        ratio = predicted_fee_eur / club_ceiling
        # ratio <= 1 (club can afford) -> ~1.0; ratio >> 1 (too expensive) -> decays.
        fee_fit = float(np.exp(-0.5 * (max(np.log(ratio), 0.0) / 1.0) ** 2))
    else:
        fee_fit = 0.0

    vol_fit = float(np.log1p(club.n_inbound) / np.log1p(100.0))  # normalized activity

    return (
        W_POSITION * pos_fit
        + W_NATIONALITY * nat_fit
        + W_SOURCE_LEAGUE * src_fit
        + W_AGE * age_fit
        + W_FEE_BAND * fee_fit
        + W_VOLUME * min(vol_fit, 1.0)
    )
