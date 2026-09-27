"""Feature engineering for the enriched (Tier 0-A..D + Tier 1-E,F,G) pipeline.

What this module owns:
  - Tier 0-D: position group one-hot + position × stat interactions.
  - Tier 0-C: encoding of transfer-table categoricals (window, league_2,
              nationality, club_2, team_name).
  - Tier 1-E: age-curve features (Age^2, peak_distance).
  - Tier 1-F: per-season inflation deflator + extrapolation to unseen seasons.
  - Tier 1-G: 3-season rolling/trajectory features from a player's prior FBref
              history.

Train- vs predict-time symmetry: every transformation is stateless on the row
itself, OR depends only on artifacts fit from training (encoders, deflator,
trajectory tables). Those artifacts are passed in explicitly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import numpy as np
import pandas as pd

from .features import assign_position_group


# ---- Tier 0-D: position group ------------------------------------------------

POS_GROUPS = ("forward", "midfielder", "defender")


def add_position_group(df: pd.DataFrame) -> pd.DataFrame:
    """Add position group one-hot columns from FBref `Pos`."""
    out = df.copy()
    out["pos_group"] = out["Pos"].apply(assign_position_group)
    for g in POS_GROUPS:
        out[f"pos_{g}"] = (out["pos_group"] == g).astype(int)
    return out


def add_position_interactions(df: pd.DataFrame) -> pd.DataFrame:
    """A handful of position × stat interactions where the prior is strong."""
    out = df.copy()
    if "xG_Expected" in out.columns:
        out["xG_x_forward"] = out["xG_Expected"].fillna(0) * out.get("pos_forward", 0)
    if "xAG_Expected" in out.columns:
        out["xAG_x_midfielder"] = out["xAG_Expected"].fillna(0) * out.get("pos_midfielder", 0)
    if "Tkl+Int_def" in out.columns:
        out["TklInt_x_defender"] = pd.to_numeric(out["Tkl+Int_def"], errors="coerce").fillna(0) * out.get("pos_defender", 0)
    return out


# ---- Tier 0-C: transfer-table categoricals -----------------------------------

# Six biggest selling leagues into the PL; everything else is "other".
TOP_LEAGUES_2 = ["Premier League", "Championship", "Ligue 1", "LaLiga", "Bundesliga", "Serie A"]
ENGLISH_NATIONS = {"England"}
# Pragmatic EU/EEA list — used only for a Brexit "no-permit-risk" flag.
EU_NATIONS = {
    "England", "Scotland", "Wales", "Northern Ireland", "Ireland",
    "France", "Germany", "Spain", "Italy", "Portugal", "Netherlands", "Belgium",
    "Austria", "Sweden", "Denmark", "Finland", "Norway", "Iceland",
    "Poland", "Czech Republic", "Slovakia", "Slovenia", "Hungary", "Croatia",
    "Romania", "Bulgaria", "Greece", "Cyprus", "Malta", "Luxembourg",
    "Estonia", "Latvia", "Lithuania", "Switzerland",
}


def add_categorical_flags(df: pd.DataFrame) -> pd.DataFrame:
    """Window, league_2, nationality flags. No fitting needed — pure mapping."""
    out = df.copy()
    win = out["window"].astype(str).str.strip().str.lower()
    out["window_winter"] = (win == "winter").astype(int)

    league = out["league_2"].astype(str).str.strip()
    for lg in TOP_LEAGUES_2:
        out[f"from_{_slug(lg)}"] = (league == lg).astype(int)

    nat = out["player_nationality"].astype(str).str.strip()
    out["nat_is_english"] = nat.isin(ENGLISH_NATIONS).astype(int)
    out["nat_is_eu"] = nat.isin(EU_NATIONS).astype(int)
    return out


def _slug(s: str) -> str:
    return s.lower().replace(" ", "_")


@dataclass
class FrequencyEncoders:
    """Frequency encoders fit from training data only; safe at predict time."""
    by_col: dict[str, dict[str, int]] = field(default_factory=dict)

    def fit(self, df: pd.DataFrame, cols: Iterable[str]) -> "FrequencyEncoders":
        self.by_col = {}
        for c in cols:
            counts = df[c].astype(str).value_counts().to_dict()
            self.by_col[c] = {k: int(v) for k, v in counts.items()}
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        for c, mapping in self.by_col.items():
            out[f"{c}_freq"] = out[c].astype(str).map(mapping).fillna(0).astype(int)
        return out

    def to_dict(self) -> dict:
        return {"by_col": self.by_col}

    @classmethod
    def from_dict(cls, d: dict) -> "FrequencyEncoders":
        return cls(by_col={k: dict(v) for k, v in d.get("by_col", {}).items()})


# ---- Tier 1-E: age curve -----------------------------------------------------

PEAK_AGE = 26


def add_age_curve(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    # FBref 'Age' string can be like '24-123' (years-days). Take leading int.
    age = out["Age"].astype(str).str.split("-").str[0]
    age = pd.to_numeric(age, errors="coerce")
    out["age_years"] = age
    out["age_sq"] = age ** 2
    out["peak_distance"] = (age - PEAK_AGE).abs()
    return out


# ---- Tier 1-F: inflation deflator --------------------------------------------

@dataclass
class FeeDeflator:
    """Per-season fee deflator with linear extrapolation in log-space.

    fit on training rows: for each season, the median disclosed fee.
    deflator[s] = median[s] / median[baseline]; baseline season → 1.0.
    Unseen seasons use linear extrapolation of log(deflator) on year.
    """
    baseline_season: str = "2014"
    deflator: dict[str, float] = field(default_factory=dict)

    def fit(self, df: pd.DataFrame, season_col: str = "season", fee_col: str = "transfer_fee") -> "FeeDeflator":
        medians = df.groupby(df[season_col].astype(str))[fee_col].median()
        if self.baseline_season not in medians.index:
            self.baseline_season = str(medians.index.min())
        baseline = float(medians[self.baseline_season])
        self.deflator = {s: float(v) / baseline for s, v in medians.items()}
        return self

    def extrapolate(self, target_seasons: Iterable[str]) -> "FeeDeflator":
        targets = [str(s) for s in target_seasons]
        missing = [s for s in targets if s not in self.deflator]
        if not missing:
            return self
        yrs = np.array([int(s) for s in self.deflator])
        vals = np.log(np.array(list(self.deflator.values())))
        coefs = np.polyfit(yrs, vals, 1)
        for s in missing:
            self.deflator[s] = float(np.exp(np.polyval(coefs, int(s))))
        return self

    def factor(self, season: str) -> float:
        return float(self.deflator[str(season)])

    def deflate(self, y: pd.Series, seasons: pd.Series) -> pd.Series:
        return y / seasons.astype(str).map(self.deflator)

    def inflate(self, y: pd.Series | np.ndarray, seasons: pd.Series) -> pd.Series:
        y_s = pd.Series(y).reset_index(drop=True)
        return y_s * seasons.astype(str).reset_index(drop=True).map(self.deflator)

    def to_dict(self) -> dict:
        return {"baseline_season": self.baseline_season, "deflator": self.deflator}

    @classmethod
    def from_dict(cls, d: dict) -> "FeeDeflator":
        return cls(baseline_season=d["baseline_season"], deflator={str(k): float(v) for k, v in d["deflator"].items()})


# ---- Tier 1-G: multi-season trajectory ---------------------------------------

TRAJ_STATS_RAW = ["Min_Playing", "xG_Expected", "xAG_Expected"]


def build_trajectory_features(
    stats_history: pd.DataFrame,
    name_col: str = "Player",
    season_col: str = "Season_End_Year",
) -> pd.DataFrame:
    """Per (player, season_end_year) compute 3-season lookback stats.

    `stats_history` is the standard-table FBref frame over a wide year range.
    Returns a frame keyed on (_name_norm, _join_season_end) with:
      - min_prior_3yr_mean, xg_per90_prior_3yr_mean, xag_per90_prior_3yr_mean
      - min_slope_prior_3yr (slope of Min_Playing over the prior 3 seasons)
      - seasons_in_big5_prior

    The join uses _name_norm (lowercased ASCII player name) so it matches the
    transfer-side join key from src/data._normalize_name.
    """
    from .data import _normalize_name

    df = stats_history[[name_col, season_col] + TRAJ_STATS_RAW].copy()
    df[season_col] = df[season_col].astype(int)
    df["_name_norm"] = _normalize_name(df[name_col])

    for c in TRAJ_STATS_RAW:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # Aggregate per (name, season) in case a player has multiple club rows.
    df = df.groupby(["_name_norm", season_col], as_index=False).agg({
        "Min_Playing": "sum",
        "xG_Expected": "sum",
        "xAG_Expected": "sum",
    })

    df["xg_per90"] = np.where(df["Min_Playing"] > 0, df["xG_Expected"] / (df["Min_Playing"] / 90), np.nan)
    df["xag_per90"] = np.where(df["Min_Playing"] > 0, df["xAG_Expected"] / (df["Min_Playing"] / 90), np.nan)

    out_rows = []
    for name, sub in df.groupby("_name_norm"):
        sub = sub.sort_values(season_col)
        for _, row in sub.iterrows():
            yr = int(row[season_col])
            prior = sub[(sub[season_col] < yr) & (sub[season_col] >= yr - 3)]
            n_prior = len(prior)
            mins_mean = float(prior["Min_Playing"].mean()) if n_prior else np.nan
            xg_mean = float(prior["xg_per90"].mean()) if n_prior else np.nan
            xag_mean = float(prior["xag_per90"].mean()) if n_prior else np.nan
            if n_prior >= 2 and prior["Min_Playing"].notna().sum() >= 2:
                x = prior[season_col].astype(float).to_numpy()
                y = prior["Min_Playing"].astype(float).to_numpy()
                slope = float(np.polyfit(x, y, 1)[0])
            else:
                slope = np.nan
            out_rows.append({
                "_name_norm": name,
                "_join_season_end": yr,
                "min_prior_3yr_mean": mins_mean,
                "xg_per90_prior_3yr_mean": xg_mean,
                "xag_per90_prior_3yr_mean": xag_mean,
                "min_slope_prior_3yr": slope,
                "seasons_in_big5_prior": int(n_prior),
            })
    return pd.DataFrame(out_rows)


def attach_trajectory(df: pd.DataFrame, traj: pd.DataFrame) -> pd.DataFrame:
    """Left-join trajectory features onto an already-joined transfer+stats frame."""
    if "_name_norm" not in df.columns or "_join_season_end" not in df.columns:
        raise KeyError("attach_trajectory requires _name_norm and _join_season_end (set by data.join_transfers_with_prior_season_stats)")
    return df.merge(traj, on=["_name_norm", "_join_season_end"], how="left").reset_index(drop=True)


# ---- Destination league one-hot ----------------------------------------------

DEST_LEAGUES = ["Premier League", "Serie A", "Ligue 1", "LaLiga", "Bundesliga"]


def add_league_onehot(df: pd.DataFrame) -> pd.DataFrame:
    """One-hot encode the destination `league` column into 5 binary columns."""
    out = df.copy()
    for lg in DEST_LEAGUES:
        col = "league_" + _slug(lg)
        out[col] = (out["league"].astype(str) == lg).astype(int)
    return out


# ---- One-shot enrichment -----------------------------------------------------

NUMERIC_EXTRAS = [
    "prior_market_value_eur",
    "player_height_mtrs",
    "contract_years_remaining",
    "tenure_at_selling_club_years",
    "min_prior_3yr_mean",
    "xg_per90_prior_3yr_mean",
    "xag_per90_prior_3yr_mean",
    "min_slope_prior_3yr",
    "seasons_in_big5_prior",
    "age_years",
    "age_sq",
    "peak_distance",
    "window_winter",
    "nat_is_english",
    "nat_is_eu",
    "pos_forward",
    "pos_midfielder",
    "pos_defender",
    "xG_x_forward",
    "xAG_x_midfielder",
    "TklInt_x_defender",
] + [f"from_{_slug(lg)}" for lg in TOP_LEAGUES_2] + [
    "league_" + _slug(lg) for lg in DEST_LEAGUES
] + ["season_numeric"]


def enrich(df: pd.DataFrame) -> pd.DataFrame:
    """Run all stateless enrichments (position, age, categoricals).

    Stateful pieces (frequency encoders, deflator, trajectory) are applied
    separately because they need fit artifacts from training.
    """
    out = df.copy()
    out = add_position_group(out)
    out = add_position_interactions(out)
    out = add_categorical_flags(out)
    out = add_age_curve(out)
    out = add_league_onehot(out)
    out["season_numeric"] = pd.to_numeric(out["season"], errors="coerce")
    if "player_foot" in out.columns:
        foot = out["player_foot"].astype(str)
        out["foot_right"] = (foot == "right").astype(int)
        out["foot_left"] = (foot == "left").astype(int)
        out["foot_both"] = (foot == "both").astype(int)
    return out
