"""STAGE 1 (PL) — Per-CLUB squad valuation & strength rating.

Mirrors worldcup/src/squad_strength_v2.build_team_ratings_v2, but the unit is a
Premier League CLUB instead of a national team. The build path is identical and
deliberately *pre-registered* (no per-club tuning): we value every player off
their real 2025/26 form with the existing transfer-fee model, aggregate the top
~15 with the same synergy logic, then blend with each club's Transfermarkt squad
value on a common log scale into one `rating` (mean 100, sd 15) that the league
Monte-Carlo consumes.

Honesty note: nothing here is tuned to produce a particular champion. The only
knobs are `model_w` / `tm_w` (form-weight vs market-value weight), which the
sensitivity grid in run_prediction varies *transparently* and reports for every
club — they are not searched for an Arsenal-favourable setting.

Reuses, does NOT modify: the fee-model artifacts + predict path
(worldcup.src.squad_strength), the synergy aggregation (worldcup.src.synergy),
and the z-score-log blend.
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

# Reuse the WC v2 fee-model load/predict, synergy, z-score-log verbatim.
from worldcup.src import squad_strength as ss  # noqa: E402
from worldcup.src import synergy  # noqa: E402
from worldcup.src import squad_strength_v2 as ssv2  # noqa: E402

_PL_DATA = Path(__file__).resolve().parents[1] / "data"

# The 20 clubs of the 2025/26 Premier League, exactly as the `Squad` column spells
# them in the Stathead export (verified against load_stathead_2526()). Promoted
# 2025/26 sides: Sunderland, Burnley, Leeds United.
PL_CLUBS_2526 = [
    "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton",
    "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham",
    "Leeds United", "Liverpool", "Manchester City", "Manchester Utd",
    "Newcastle United", "Nottingham Forest", "Sunderland", "Tottenham Hotspur",
    "West Ham United", "Wolves",
]

# English club name -> Korean label for the web/report layer.
CLUB_KO = {
    "Arsenal": "아스널", "Aston Villa": "아스톤 빌라", "Bournemouth": "본머스",
    "Brentford": "브렌트퍼드", "Brighton": "브라이턴", "Burnley": "번리",
    "Chelsea": "첼시", "Crystal Palace": "크리스털 팰리스", "Everton": "에버턴",
    "Fulham": "풀럼", "Leeds United": "리즈 유나이티드", "Liverpool": "리버풀",
    "Manchester City": "맨체스터 시티", "Manchester Utd": "맨체스터 유나이티드",
    "Newcastle United": "뉴캐슬", "Nottingham Forest": "노팅엄 포레스트",
    "Sunderland": "선덜랜드", "Tottenham Hotspur": "토트넘",
    "West Ham United": "웨스트햄", "Wolves": "울버햄튼",
}


def load_club_pool_2526() -> pd.DataFrame:
    """Per-player 2025/26 pool for the 20 PL clubs, with real stats + joined MV.

    Filters the Stathead export to rows whose `Squad` is a current PL club, drops
    the ambiguous "N Teams" mid-season-mover aggregates (they carry no single-club
    attribution), joins the 2022 TM market value by normalized name (median-fills
    the unmatched), and buckets each player to a GK/DF/MF/FW line. `team` is the
    CLUB so synergy.all_team_strengths groups by club.
    """
    sh = load_stathead_2526().copy()
    sh = sh[sh["Squad"].isin(PL_CLUBS_2526) & (~sh["multi_team"].astype(bool))].copy()

    # Join 2022 MV by normalized name (reuse the WC v2 helper); median-fill rest.
    sh["_k"] = _normalize_name(sh["Player"])
    mv = ssv2._load_2022_mv_by_name()
    sh = sh.merge(mv, on="_k", how="left")
    median_mv = float(sh["mv_eur"].median())
    sh["mv_eur"] = sh["mv_eur"].fillna(median_mv)

    sh["age_years"] = pd.to_numeric(sh["Age"], errors="coerce")
    grp = sh["Pos"].map(assign_position_group)
    sh["pos_bucket"] = grp.map(
        {"forward": "FW", "midfielder": "MF", "defender": "DF", "goalkeeper": "GK"}
    ).fillna("MF")
    sh["club"] = sh["Squad"].astype(str)
    sh["team"] = sh["Squad"].astype(str)  # synergy groups on `team`; here team == club
    return sh.reset_index(drop=True)


def _build_model_input_club(pool: pd.DataFrame, art: ss.Artifacts, season: str = "2022") -> pd.DataFrame:
    """Model input for valuing a player *as-is at their current club*.

    Identical to squad_strength_v2._build_model_input_2526 except:
      - club_2 = the player's current PL club (drives the club-frequency / buyer
        premium encoding), and
      - player_nationality is left blank (for a single-club squad it is not a
        grouping signal; a uniform blank cancels in the cross-club z-score).
    MV is deflated to the model's 2014-€ training scale; stats pass through as the
    real 2025/26 values. Unsupplied features (pass %, contract, league flags) are
    training-median-filled by ss._prepare_feature_frame, exactly like the WC path.
    """
    out = pd.DataFrame(index=pool.index)
    out["prior_market_value_eur"] = pool["mv_eur"] / float(art.deflator.deflator.get(str(season), 1.0))
    out["age_years"] = pool["age_years"]
    out["peak_distance"] = (pool["age_years"] - 27.0).abs()
    out["pos_forward"] = (pool["pos_bucket"] == "FW").astype(float)
    out["pos_midfielder"] = (pool["pos_bucket"] == "MF").astype(float)
    out["pos_defender"] = (pool["pos_bucket"] == "DF").astype(float)
    out["season_numeric"] = 2026.0
    for c in ssv2._STAT_COLS:
        if c in pool.columns:
            out[c] = pd.to_numeric(pool[c], errors="coerce")
    out["club_2"] = pool["club"].values
    out["player_nationality"] = ""
    out["team_name"] = ""
    return out


def player_model_values_club(art: ss.Artifacts, pool: pd.DataFrame) -> pd.Series:
    """Model-implied EUR value per 2025/26 player (re-inflated to 2026-€)."""
    mdl_in = _build_model_input_club(pool, art, season="2022")
    vals = ss._model_value_eur(art, mdl_in, season="2022")
    return pd.Series(vals, index=pool.index).clip(lower=0.0)


def load_tm_club_values() -> pd.Series:
    with open(_PL_DATA / "pl_squad_values_2526.json") as f:
        d = json.load(f)
    return pd.Series(d["values"], dtype=float)  # EUR millions


def build_club_ratings(model_w: float = 0.45, tm_w: float = 0.55,
                       use_synergy: bool = True) -> pd.DataFrame:
    """Stage-1 deliverable: one strength `rating` per PL club.

    Blends two z-scored (log) signals exactly as squad_strength.build_team_ratings:
      - MODEL synergy-strength: each club's top-15 players valued on 2025/26 form,
        aggregated with the synergy multiplier (spine completeness × club chemistry).
      - TM squad value: each club's full Transfermarkt squad value (market anchor).

    `model_w` / `tm_w` are the only knobs (form-weight vs market-weight); the
    sensitivity grid varies them transparently. `use_synergy=False` drops the
    synergy multiplier (one of the disclosed sensitivity variants), valuing the
    club on the concave base only.
    """
    teams = list(PL_CLUBS_2526)
    art = ss.load_model()
    pool = load_club_pool_2526()
    pool = pool.assign(model_val=player_model_values_club(art, pool))

    strengths = synergy.all_team_strengths(pool, teams, value_col="model_val")

    df = pd.DataFrame(index=teams)
    if use_synergy:
        df["model_strength"] = strengths["strength"].reindex(teams).fillna(0.0)
    else:
        df["model_strength"] = strengths["base"].reindex(teams).fillna(0.0)
    tm = load_tm_club_values()
    df["tm_value_m"] = tm.reindex(teams)
    if df["tm_value_m"].isna().any():
        missing = df.index[df["tm_value_m"].isna()].tolist()
        raise ValueError(f"Missing TM squad value for: {missing}")

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
    df["n_core"] = strengths["n_core"].reindex(teams).fillna(0).astype(int)
    return df.sort_values("rating", ascending=False)


if __name__ == "__main__":  # quick manual sanity check
    r = build_club_ratings()
    print(r[["rating", "tm_value_m", "model_strength", "synergy_mult", "n_core"]].round(2))
