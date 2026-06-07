"""STAGE 1 — Squad valuation & ranking.

Bridges the existing player transfer-fee model (azz3) into a per-national-team
strength rating for the 2026 World Cup.

Two value signals are combined per team:
  1. MODEL signal  — for every European-based (Big-5) player of a nation, run the
                     existing XGBoost transfer-fee model on the player's profile to
                     get a model-implied value, then aggregate WITH SYNERGY
                     (see synergy.py). This is the "valuation by the existing model"
                     the user asked for. Coverage is Euro-heavy.
  2. TM anchor     — each nation's FULL 2026 Transfermarkt squad value
                     (data/tm_squad_values.json). This includes non-Euro players
                     (MLS / Saudi / Brazilian leagues) the model can't see, so it
                     fixes the coverage gap for nations like Brazil / Argentina.

The two are blended on a common (log) scale into a single STRENGTH rating that
Stage 2 consumes. The model signal is what reorders teams of similar TM value via
squad quality + synergy; the TM anchor keeps non-Euro squads from being undervalued.

Reuses, does NOT modify: data/models/xgb_transfer_fee.pkl + selected_features.json,
and the exact load/predict pattern from scripts/predict.py.
"""
from __future__ import annotations

import json
import pickle
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

# Reuse the project's model artifacts + encoder/deflator helpers.
import sys

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src import config  # noqa: E402
from src.enrich import FeeDeflator, FrequencyEncoders  # noqa: E402

_WC_DATA = Path(__file__).resolve().parents[1] / "data"

# Map RDS nationality strings -> our WC team names (groups_2026.json).
# Most match verbatim; these are the exceptions found in big5_player_vals.rds.
_NAT_TO_TEAM = {
    "Korea, South": "South Korea",
    "Czech Republic": "Czechia",
    "Turkey": "Turkiye",
    "Cote d'Ivoire": "Ivory Coast",
    "DR Congo": "Congo DR",
    "Congo": "Congo DR",  # some rows use bare "Congo" for DR Congo players
    "USA": "United States",
}


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
    return Artifacts(
        model=model,
        features=meta["features"],
        rename_map=rename_map,
        inverse_rename=inverse,
        medians=pd.Series(meta["medians"]),
        freq_encoders=FrequencyEncoders.from_dict(meta.get("freq_encoders", {})),
        deflator=FeeDeflator.from_dict(meta["deflator"]),
        target_transform=meta.get("target_transform", "nominal"),
    )


def _prepare_feature_frame(art: Artifacts, df: pd.DataFrame) -> pd.DataFrame:
    """Apply freq encoders, rename for xgb safety, fill NaNs with training medians.

    Mirrors scripts/predict.py::_prepare_feature_frame.
    """
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


def _model_value_eur(art: Artifacts, df: pd.DataFrame, season: str = "2022") -> np.ndarray:
    """Run the model -> nominal EUR value per player row."""
    X = _prepare_feature_frame(art, df)
    raw = np.asarray(art.model.predict(X)).astype(float)
    factor = float(art.deflator.deflator.get(str(season), 1.0))
    if art.target_transform == "log1p_deflated":
        return np.expm1(raw) * factor
    if art.target_transform == "deflated":
        return raw * factor
    return raw


_POS_PRIORITY = {  # coarse line bucket from player_position text
    "Goalkeeper": "GK",
    "Centre-Back": "DF", "Left-Back": "DF", "Right-Back": "DF", "Defender": "DF",
    "Defensive Midfield": "MF", "Central Midfield": "MF", "Attacking Midfield": "MF",
    "Left Midfield": "MF", "Right Midfield": "MF", "Midfielder": "MF",
    "Centre-Forward": "FW", "Left Winger": "FW", "Right Winger": "FW",
    "Second Striker": "FW", "Forward": "FW",
}


def _bucket_position(pos: str) -> str:
    if not isinstance(pos, str):
        return "MF"
    return _POS_PRIORITY.get(pos.strip(), "MF")


def load_player_pool(season: int = 2022) -> pd.DataFrame:
    """Per-player Big-5 market-value records for the latest season, keyed to WC teams.

    Returns one row per European-based player of every WC nation we can see, with
    the columns the model needs (market value, position one-hots, age, league freq
    inputs) plus identity columns for synergy (team, club, position bucket).
    """
    rds = config.RAW_DIR / "wfr" / "big5_player_vals.rds"
    import rdata
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        obj = rdata.read_rds(str(rds))
    df = obj if isinstance(obj, pd.DataFrame) else pd.DataFrame(obj)
    df["season_start_year"] = pd.to_numeric(df["season_start_year"], errors="coerce")
    df = df[df["season_start_year"] == season].copy()

    df["team"] = df["player_nationality"].map(lambda n: _NAT_TO_TEAM.get(n, n))
    df["mv_eur"] = pd.to_numeric(df["player_market_value_euro"], errors="coerce")
    df = df[df["mv_eur"].notna() & (df["mv_eur"] > 0)].copy()
    df["age_years"] = pd.to_numeric(df["player_age"], errors="coerce")
    df["pos_bucket"] = df["player_position"].map(_bucket_position)
    df["club"] = df["current_club"].astype(str)
    return df.reset_index(drop=True)


def _build_model_input(pool: pd.DataFrame) -> pd.DataFrame:
    """Construct the model's expected raw columns from the player pool.

    We have market value, age, position. Stats (xG, shots, ...) are unknown for an
    arbitrary national-team player, so they are left NaN and median-imputed by
    _prepare_feature_frame — i.e. the model values each player primarily off
    market value + age curve + position + league, which is exactly the squad-quality
    signal we want at Stage 1 (not a per-match stat forecast).
    """
    out = pd.DataFrame(index=pool.index)
    out["prior_market_value_eur"] = pool["mv_eur"]
    out["age_years"] = pool["age_years"]
    # peak_distance ~ age - 27 (peak age prior used in enrich.py age curve)
    out["peak_distance"] = pool["age_years"] - 27.0
    out["pos_forward"] = (pool["pos_bucket"] == "FW").astype(float)
    out["pos_midfielder"] = (pool["pos_bucket"] == "MF").astype(float)
    out["pos_defender"] = (pool["pos_bucket"] == "DF").astype(float)
    out["season_numeric"] = 2022.0
    # League flags unknown per national player -> leave 0 (median fill handles rest).
    # Supply the raw categorical columns the frequency encoder expects so it can map
    # real frequencies (club, nationality) and zero-fill the rest (team_name unknown).
    # The dominant signal at Stage 1 remains prior_market_value_eur.
    out["club_2"] = pool["club"].values
    out["player_nationality"] = pool["team"].values
    out["team_name"] = ""  # destination club unknown for a national-team player
    return out


def player_model_values(art: Artifacts, pool: pd.DataFrame) -> pd.Series:
    """Model-implied EUR value for each player in the pool."""
    mdl_in = _build_model_input(pool)
    vals = _model_value_eur(art, mdl_in, season="2022")
    return pd.Series(vals, index=pool.index).clip(lower=0.0)


# --------------------------------------------------------------------------- #
# Stage-1 assembly: blend MODEL synergy-strength with the TM full-squad anchor #
# --------------------------------------------------------------------------- #

def load_tm_values() -> pd.Series:
    with open(_WC_DATA / "tm_squad_values.json") as f:
        d = json.load(f)
    return pd.Series(d["values"], dtype=float)  # EUR millions


def load_wc_teams() -> list:
    with open(_WC_DATA / "groups_2026.json") as f:
        d = json.load(f)
    teams = []
    for g in d["groups"].values():
        teams.extend(g)
    return teams


def _zscore_log(s: pd.Series) -> pd.Series:
    x = np.log(s.clip(lower=1.0))
    return (x - x.mean()) / (x.std(ddof=0) + 1e-9)


def build_team_ratings(model_w: float = 0.45, tm_w: float = 0.55) -> pd.DataFrame:
    """Stage-1 deliverable: one strength rating per WC team.

    Blends two z-scored (log) signals:
      - MODEL synergy-strength (squad_strength + synergy.py), Euro-based players.
      - TM full 2026 squad value (covers non-Euro players).

    TM is weighted a touch higher because it has full-squad coverage; the model
    signal reorders teams of similar TM value by squad quality + synergy. The output
    `rating` is a unitless strength on a common scale used by Stage 2.
    """
    from worldcup.src import synergy

    teams = load_wc_teams()
    art = load_model()
    pool = load_player_pool(2022)
    pool = pool.assign(model_val=player_model_values(art, pool))

    strengths = synergy.all_team_strengths(pool, teams, value_col="model_val")
    tm = load_tm_values()

    df = pd.DataFrame(index=teams)
    df["model_strength"] = strengths["strength"].reindex(teams).fillna(0.0)
    df["tm_value_m"] = tm.reindex(teams)
    if df["tm_value_m"].isna().any():
        missing = df.index[df["tm_value_m"].isna()].tolist()
        raise ValueError(f"Missing TM value for: {missing}")

    # For teams with ~no Euro-based model signal, fall the model signal back to a
    # TM-implied floor so the z-score isn't dominated by structural zeros.
    floor = df["tm_value_m"] * 1e6 * 0.5  # crude: half of squad value as model proxy
    df["model_strength_eff"] = np.where(df["model_strength"] <= 0,
                                        floor, df["model_strength"])

    zm = _zscore_log(df["model_strength_eff"])
    zt = _zscore_log(df["tm_value_m"])
    df["z_model"] = zm
    df["z_tm"] = zt
    blended_z = model_w * zm + tm_w * zt

    # Map blended z to a positive rating (mean 100, ~15 sd) for readable Stage-2 input.
    df["rating"] = 100.0 + 15.0 * blended_z
    df["synergy_mult"] = strengths["synergy_mult"].reindex(teams).fillna(1.0)
    df["spine"] = strengths["spine"].reindex(teams).fillna(1.0)
    df["chemistry"] = strengths["chemistry"].reindex(teams).fillna(1.0)
    df["n_core_euro"] = strengths["n_core"].reindex(teams).fillna(0).astype(int)
    return df.sort_values("rating", ascending=False)
