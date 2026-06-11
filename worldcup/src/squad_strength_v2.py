"""STAGE 1 (v2) — Squad valuation from 2025/26 player stats.

Difference from v1 (squad_strength.py):
  v1 valued each player off a 2022 market-value snapshot with stats median-filled.
  v2 values each player off their REAL 2025/26 form — the Stathead standard-stats
  export (goals/assists/minutes + goals-proxy xG/shooting) that the destination
  module already ingests. The fee model's stat features (xG, shots, per-90 rates)
  combined carry ~26% importance, comparable to market value (~28%), so a
  stat-driven valuation reflects current form rather than a stale snapshot.

  Market value is still useful (the model's single strongest feature), so we
  name-join each 2025/26 player to their 2022 TM market value where it exists
  (~36% of the cohort — many 2025/26 Big-5 players weren't in the 2022 Big-5);
  the rest median-fill. Net: the v2 model signal leans on current stats + the
  2026 TM squad-value anchor more than v1 did, which is the intended upgrade.

Reuses, does NOT modify: the fee model artifacts, the v1 synergy + TM-anchor
blend (build path mirrors squad_strength.build_team_ratings), and the
deflation-correct predict path.
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

from src.data import load_player_vals, load_stathead_2526, _normalize_name  # noqa: E402
from src.features import assign_position_group  # noqa: E402

# Reuse v1's model load/predict, synergy, TM anchor, and team list verbatim.
from worldcup.src import squad_strength as ss  # noqa: E402

_WC_DATA = Path(__file__).resolve().parents[1] / "data"

# FBref lowercase country code -> WC team name (groups_2026.json). Only the codes
# that map to a 2026 WC nation need an entry; everyone else is dropped from the
# pool (they don't play in the tournament).
_CODE_TO_TEAM = {
    "dz": "Algeria", "ar": "Argentina", "au": "Australia", "at": "Austria",
    "be": "Belgium", "ba": "Bosnia-Herzegovina", "br": "Brazil", "ca": "Canada",
    "cv": "Cape Verde", "co": "Colombia", "cd": "Congo DR", "hr": "Croatia",
    "cw": "Curacao", "cz": "Czechia", "ec": "Ecuador", "eg": "Egypt",
    "eng": "England", "fr": "France", "de": "Germany", "gh": "Ghana",
    "ht": "Haiti", "ir": "Iran", "iq": "Iraq", "ci": "Ivory Coast",
    "jp": "Japan", "jo": "Jordan", "mx": "Mexico", "ma": "Morocco",
    "nl": "Netherlands", "nz": "New Zealand", "no": "Norway", "pa": "Panama",
    "py": "Paraguay", "pt": "Portugal", "qa": "Qatar", "sa": "Saudi Arabia",
    "sct": "Scotland", "sn": "Senegal", "za": "South Africa", "kr": "South Korea",
    "es": "Spain", "se": "Sweden", "ch": "Switzerland", "tn": "Tunisia",
    "tr": "Turkiye", "us": "United States", "uy": "Uruguay", "uz": "Uzbekistan",
}


def _load_2022_mv_by_name() -> pd.DataFrame:
    """2022 TM market value keyed by normalized player name (best available MV)."""
    mv = load_player_vals(seasons=[2022]).copy()
    mv["mv_eur"] = pd.to_numeric(mv["player_market_value_euro"], errors="coerce")
    mv = mv[mv["mv_eur"].notna() & (mv["mv_eur"] > 0)]
    mv["_k"] = _normalize_name(mv["player_name"])
    # Keep the highest MV per name (handles mid-season club moves / dupes).
    mv = mv.sort_values("mv_eur", ascending=False).drop_duplicates("_k")
    return mv[["_k", "mv_eur"]]


def load_player_pool_2526() -> pd.DataFrame:
    """Per-player 2025/26 pool keyed to WC teams, with real stats + joined MV.

    Columns the downstream needs: team, club, pos_bucket, age_years, mv_eur,
    plus all the FBref-named stat columns the fee model consumes.
    """
    sh = load_stathead_2526().copy()
    sh["team"] = sh["Nation"].map(_CODE_TO_TEAM)
    sh = sh[sh["team"].notna()].copy()  # only WC nations

    # Join 2022 MV by normalized name; median-fill the unmatched.
    sh["_k"] = _normalize_name(sh["Player"])
    mv = _load_2022_mv_by_name()
    sh = sh.merge(mv, on="_k", how="left")
    median_mv = float(sh["mv_eur"].median())
    sh["mv_eur"] = sh["mv_eur"].fillna(median_mv)

    sh["age_years"] = pd.to_numeric(sh["Age"], errors="coerce")
    # FBref Pos like "FW,MF" -> forward/midfielder/defender -> GK/DF/MF/FW bucket.
    grp = sh["Pos"].map(assign_position_group)
    sh["pos_bucket"] = grp.map(
        {"forward": "FW", "midfielder": "MF", "defender": "DF", "goalkeeper": "GK"}
    ).fillna("MF")
    sh["club"] = sh["Squad"].astype(str)
    return sh.reset_index(drop=True)


# Stat columns to forward from the Stathead row into the model input (the real
# 2025/26 signal). Mirrors the fee model's selected stat features.
_STAT_COLS = [
    "MP_Playing", "Min_Playing", "Ast", "PK", "CrdR", "Gls_Per", "Ast_Per", "G+A_Per",
    "xAG_Expected", "xG_Per", "xAG_Per",
    "Sh_Standard_shoot", "SoT_Standard_shoot", "SoT_percent_Standard_shoot",
    "Sh_per_90_Standard_shoot", "SoT_per_90_Standard_shoot",
]


def _build_model_input_2526(pool: pd.DataFrame, art: ss.Artifacts, season: str = "2022") -> pd.DataFrame:
    """Model input from the 2025/26 pool: real stats + deflated MV + position.

    MV is deflated to 2014-€ to match the retrained model's input scale (same fix
    as v1's _build_model_input). Stats are passed through as real 2025/26 values.
    """
    out = pd.DataFrame(index=pool.index)
    out["prior_market_value_eur"] = pool["mv_eur"] / float(art.deflator.deflator.get(str(season), 1.0))
    out["age_years"] = pool["age_years"]
    out["peak_distance"] = (pool["age_years"] - 27.0).abs()
    out["pos_forward"] = (pool["pos_bucket"] == "FW").astype(float)
    out["pos_midfielder"] = (pool["pos_bucket"] == "MF").astype(float)
    out["pos_defender"] = (pool["pos_bucket"] == "DF").astype(float)
    out["season_numeric"] = 2026.0
    for c in _STAT_COLS:
        if c in pool.columns:
            out[c] = pd.to_numeric(pool[c], errors="coerce")
    # Raw categoricals for the frequency encoder.
    out["club_2"] = pool["club"].values
    out["player_nationality"] = pool["team"].values
    out["team_name"] = ""
    return out


def player_model_values_2526(art: ss.Artifacts, pool: pd.DataFrame) -> pd.Series:
    """Model-implied EUR value per 2025/26 player (re-inflated to 2026-€)."""
    mdl_in = _build_model_input_2526(pool, art, season="2022")
    vals = ss._model_value_eur(art, mdl_in, season="2022")
    return pd.Series(vals, index=pool.index).clip(lower=0.0)


def build_team_ratings_v2(model_w: float = 0.45, tm_w: float = 0.55) -> pd.DataFrame:
    """v2 Stage-1: blend the 2025/26-stat model signal with the 2026 TM anchor.

    Mirrors squad_strength.build_team_ratings but swaps the player pool for the
    2025/26-stats pool. Synergy and the TM anchor blend are unchanged.
    """
    from worldcup.src import synergy

    teams = ss.load_wc_teams()
    art = ss.load_model()
    pool = load_player_pool_2526()
    pool = pool.assign(model_val=player_model_values_2526(art, pool))

    strengths = synergy.all_team_strengths(pool, teams, value_col="model_val")
    tm = ss.load_tm_values()

    df = pd.DataFrame(index=teams)
    df["model_strength"] = strengths["strength"].reindex(teams).fillna(0.0)
    df["tm_value_m"] = tm.reindex(teams)
    if df["tm_value_m"].isna().any():
        missing = df.index[df["tm_value_m"].isna()].tolist()
        raise ValueError(f"Missing TM value for: {missing}")

    floor = df["tm_value_m"] * 1e6 * 0.5
    df["model_strength_eff"] = np.where(df["model_strength"] <= 0, floor, df["model_strength"])

    zm = ss._zscore_log(df["model_strength_eff"])
    zt = ss._zscore_log(df["tm_value_m"])
    df["z_model"] = zm
    df["z_tm"] = zt
    blended_z = model_w * zm + tm_w * zt

    df["rating"] = 100.0 + 15.0 * blended_z
    df["synergy_mult"] = strengths["synergy_mult"].reindex(teams).fillna(1.0)
    df["spine"] = strengths["spine"].reindex(teams).fillna(1.0)
    df["chemistry"] = strengths["chemistry"].reindex(teams).fillna(1.0)
    df["n_core_euro"] = strengths["n_core"].reindex(teams).fillna(0).astype(int)
    return df.sort_values("rating", ascending=False)
