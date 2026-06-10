"""Thin reuse of the trained transfer-fee model for the destination recommender.

This is a near-verbatim lift of the load/predict path proven in
worldcup/src/squad_strength.py (which itself mirrors scripts/predict.py). It does
NOT modify the model artifacts.

Key fact this module makes explicit: the fee model has NO destination-club
feature (team_name is excluded from training), so a given player yields ONE
predicted fee regardless of where he might move. We predict the fee once per
player; the destination layer ranks clubs separately and only shapes a fee
*range* around this point estimate.
"""
from __future__ import annotations

import json
import pickle
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src import config  # noqa: E402
from src.enrich import DEST_LEAGUES, PEAK_AGE, FeeDeflator, FrequencyEncoders, _slug  # noqa: E402
from src.features import assign_position_group  # noqa: E402

# Prediction season for the 2026 window. The model works entirely in 2014-€
# (both the market-value input and the fee target were deflated at train time),
# so we deflate a player's 2026 market value into 2014-€ before predicting and
# re-inflate the 2014-€ fee back to 2026-€ after. The 2026 deflator factor is
# extrapolated from the train-fit deflator on load.
FEE_REFERENCE_SEASON = "2026"


@dataclass
class Artifacts:
    model: object
    features: list
    rename_map: dict
    inverse_rename: dict
    medians: pd.Series
    freq_encoders: FrequencyEncoders
    deflator: FeeDeflator
    target_transform: str
    buyer_premium_map: dict        # team_name -> fee/market-value premium ratio
    buyer_premium_default: float   # global fallback for unseen clubs


def load_model() -> Artifacts:
    """Load the trained transfer-fee model exactly as scripts/predict.py does."""
    model_path = config.MODELS_DIR / "xgb_transfer_fee.pkl"
    feats_path = config.MODELS_DIR / "selected_features.json"
    if not model_path.exists() or not feats_path.exists():
        raise SystemExit("Run scripts/train.py first to produce model artifacts.")
    with open(model_path, "rb") as f:
        model = pickle.load(f)
    with open(feats_path) as f:
        meta = json.load(f)
    rename_map = meta.get("rename_map", {})
    inverse = {v: k for k, v in rename_map.items()}
    bpe = meta.get("buyer_premium_encoding", {"mapping": {}, "default": 1.0})
    deflator = FeeDeflator.from_dict(meta["deflator"])
    # Extrapolate the 2014-fit deflator to the 2026 window (artifact stops at 2022).
    deflator.extrapolate([FEE_REFERENCE_SEASON])
    return Artifacts(
        model=model,
        features=meta["features"],
        rename_map=rename_map,
        inverse_rename=inverse,
        medians=pd.Series(meta["medians"]),
        freq_encoders=FrequencyEncoders.from_dict(meta.get("freq_encoders", {})),
        deflator=deflator,
        target_transform=meta.get("target_transform", "nominal"),
        buyer_premium_map={str(k): float(v) for k, v in bpe.get("mapping", {}).items()},
        buyer_premium_default=float(bpe.get("default", 1.0)),
    )


def _deflate_value(art: Artifacts, value_eur: float, season: str = FEE_REFERENCE_SEASON) -> float:
    """2026-€ -> 2014-€ for the market-value input (matches train-time deflation)."""
    return float(value_eur) / float(art.deflator.deflator[str(season)])


def buyer_premium_interaction(art: Artifacts, club: str, market_value_deflated_eur: float) -> float:
    """The model's buyer x player-value interaction term for a given destination.

    Mirrors scripts/train._buyer_interaction: (premium - 1) * log1p(value), where
    value is the DEFLATED (2014-€) market value — same scale the model trained on.
    This is the ONLY place the destination club changes the predicted fee — a
    per-deal premium scaled by the player's value, never the club's total budget.
    """
    prem = art.buyer_premium_map.get(str(club), art.buyer_premium_default)
    return (prem - 1.0) * float(np.log1p(max(market_value_deflated_eur, 0.0)))


def _prepare_feature_frame(art: Artifacts, df: pd.DataFrame) -> pd.DataFrame:
    """Freq-encode, rename to xgb-safe names, median-fill. Mirrors predict.py."""
    encoded = art.freq_encoders.transform(df)
    inv = art.inverse_rename or {f: f for f in art.features}
    cols_original = [inv.get(f, f) for f in art.features]
    out = pd.DataFrame(index=encoded.index)
    for orig, xgb_name in zip(cols_original, art.features):
        if orig in encoded.columns:
            out[xgb_name] = pd.to_numeric(encoded[orig], errors="coerce")
        else:
            out[xgb_name] = np.nan
    fill = {xgb: float(art.medians.get(orig, 0.0))
            for orig, xgb in zip(cols_original, art.features)}
    out = out.fillna(value=fill).fillna(0.0)
    return out


def predict_fee_eur(art: Artifacts, df: pd.DataFrame, season: str = FEE_REFERENCE_SEASON) -> np.ndarray:
    """Run the model -> nominal EUR fee per row. Mirrors squad_strength._model_value_eur."""
    X = _prepare_feature_frame(art, df)
    raw = np.asarray(art.model.predict(X)).astype(float)
    factor = float(art.deflator.deflator.get(str(season), 1.0))
    if art.target_transform == "log1p_deflated":
        return np.expm1(raw) * factor
    if art.target_transform == "deflated":
        return raw * factor
    return raw


# FBref stat columns we forward straight from a Stathead row when present.
_STAT_PASSTHROUGH = [
    "MP_Playing", "Min_Playing", "Ast", "PK", "CrdR", "Gls_Per", "Ast_Per", "G+A_Per",
    "xAG_Expected", "xG_Per", "xAG_Per",
    "Sh_Standard_shoot", "SoT_Standard_shoot", "SoT_percent_Standard_shoot",
    "Sh_per_90_Standard_shoot", "SoT_per_90_Standard_shoot",
]


def player_to_model_row(profile: dict, stat_row: pd.Series | None = None,
                         art: Artifacts | None = None, dest_club: str | None = None) -> pd.DataFrame:
    """Build the model's expected raw columns for one player.

    `profile` carries identity + the bits a stats table can't: current club
    (club_2), nationality, market value, contract years. `stat_row` is the
    matching Stathead 2025/26 row (FBref-named cols + goals-proxy xG/shooting);
    when None, every stat falls to the training median downstream — the same
    degrade-gracefully contract scripts/predict.py's synthetic players rely on.

    The fee is now buyer-aware via ONE feature: the buyer-premium x player-value
    interaction. Pass `art` + `dest_club` to set it for a specific destination;
    omit them (or pass dest_club=None) for a neutral, destination-agnostic fee
    (interaction = 0, an average-paying club).
    """
    age = float(profile["age"])
    pos_group = profile.get("position_group") or (
        assign_position_group(str(stat_row["Pos"])) if stat_row is not None else "forward"
    )
    # Deflate the 2026 market value to 2014-€ so it lands in the model's trained
    # range (nominal training values topped out ~€150M; deflation pulls a 2026
    # €200M player back into distribution). Needs `art` for the deflator factor.
    mv_nominal = float(profile["prior_market_value_eur"])
    mv = _deflate_value(art, mv_nominal) if art is not None else mv_nominal

    if art is not None and dest_club is not None:
        buyer_term = buyer_premium_interaction(art, dest_club, mv)
    else:
        buyer_term = 0.0  # neutral / average-paying club

    row = {
        "prior_market_value_eur": mv,
        "age_years": age,
        "peak_distance": abs(age - PEAK_AGE),
        "contract_years_remaining": float(profile.get("contract_years_remaining", 3)),
        "tenure_at_selling_club_years": float(profile.get("tenure_at_selling_club_years", 3)),
        "pos_forward": int(pos_group == "forward"),
        "pos_midfielder": int(pos_group == "midfielder"),
        "pos_defender": int(pos_group == "defender"),
        "season_numeric": 2026.0,
        "buyer_premium_x_value": buyer_term,
        # Raw categoricals for the frequency encoder.
        "club_2": profile["current_club"],
        "player_nationality": profile["nationality"],
        "team_name": dest_club or "",
    }
    # Selling-league one-hot (model features league_premier_league, ...). Without
    # this they median-fill to 0.0 and the player is scored as belonging to no
    # league, killing the league fee signal the model learned at train time.
    cur_league = profile.get("current_league")
    if cur_league:
        for lg in DEST_LEAGUES:
            row[f"league_{_slug(lg)}"] = int(cur_league == lg)
    if stat_row is not None:
        for c in _STAT_PASSTHROUGH:
            if c in stat_row.index and pd.notna(stat_row[c]):
                row[c] = float(stat_row[c])
    return pd.DataFrame([row])
