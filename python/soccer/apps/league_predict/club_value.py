"""STAGE 1+2 — per-club pre-season VALUE rating from Naver data (몸값 → 시너지).

For each (league, season S) the club rating is built only from information
available BEFORE season S kicks off:

  1. Player value chain (몸값). Each player's value at the end of season S is the
     transfer-fee model's valuation given
        prior market value = his value at the end of S-1 (chain), and
        performance      = his Naver season-S stats (mapped to the model's
                           FBref-named features).
     The chain is seeded ONCE with the 2022/23 Transfermarkt value, joined to the
     Naver player by date of birth (+ nationality to break ties) because Naver
     only carries Korean names. Unseeded players get the pool median, exactly the
     rule the existing WC / PL pipelines use for unmatched MV.
  2. Pre-season value for S = the latest chain value from seasons < S.
  3. Squad (시너지): the season-S roster (Naver teamId) aggregated with the same
     synergy.team_strength as the WC / PL apps (top-15, concave per line, spine).
  4. Rating = z-score of log(strength) within the league-season.

Point-in-time caveat (disclosed in the report): the roster is the club's
season-S Naver roster, so January signings are already on it.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from core.data import load_player_vals
from soccer.engine import squad_strength as ss
from soccer.engine import synergy

from .data import load_players

SEED_SEASON = 2022          # TM snapshot season used to seed the chain
_MIN_MINUTES = 90           # below this, a season's stats carry no signal → medians

_LEAGUE_FLAG = {
    "epl": "league_premier_league", "primera": "league_laliga",
    "bundesliga": "league_bundesliga", "seria": "league_serie_a", "ligue1": "league_ligue_1",
}
_POS = {"GK": "GK", "DF": "DF", "MF": "MF", "FW": "FW"}


# --------------------------------------------------------------------------- #
# Seed: 2022/23 TM value joined by date of birth (+ nationality).               #
# --------------------------------------------------------------------------- #

def _tm_seed() -> pd.DataFrame:
    tm = load_player_vals(seasons=[SEED_SEASON]).copy()
    tm["mv_eur"] = pd.to_numeric(tm["player_market_value_euro"], errors="coerce")
    tm = tm[tm["mv_eur"] > 0].copy()
    # R Date → days since 1970-01-01.
    tm["dob"] = pd.to_datetime(pd.to_numeric(tm["player_dob"], errors="coerce"), unit="D", origin="unix")
    tm = tm.sort_values("mv_eur", ascending=False).drop_duplicates("player_url")
    return tm[["player_name", "player_nationality", "dob", "mv_eur"]]


def seed_values(players: pd.DataFrame) -> pd.Series:
    """playerId → 2022/23 TM value (EUR), for the Naver players we can match.

    Naver has only Korean names, so the key is date of birth. When several TM
    players share a birthday, nationality breaks the tie through a Korean→English
    country map LEARNED from the unambiguous birthday matches (no hand table).
    """
    tm = _tm_seed()
    nv = (players[["playerId", "dateOfBirth", "countryName"]]
          .drop_duplicates("playerId").copy())
    nv["dob"] = pd.to_datetime(nv["dateOfBirth"], errors="coerce")
    nv = nv[nv["dob"].notna()]

    m = nv.merge(tm, on="dob", how="inner")
    n_tm = m.groupby("playerId")["player_name"].transform("size")
    n_nv = m.groupby("player_name")["playerId"].transform("size")
    is_uniq = (n_tm == 1) & (n_nv == 1)
    country = (m[is_uniq].groupby("countryName")["player_nationality"]
               .agg(lambda s: s.value_counts().index[0]))

    m["nat_ok"] = m["countryName"].map(country) == m["player_nationality"]
    uniq = m[is_uniq]
    amb = m[n_tm > 1]
    resolved = amb[amb["nat_ok"]]
    resolved = resolved[resolved.groupby("playerId")["player_name"].transform("size") == 1]
    # Accept unique-birthday pairs only if nationality does not contradict.
    clean = uniq[uniq["nat_ok"] | uniq["countryName"].map(country).isna()]
    out = pd.concat([clean, resolved])
    return out.drop_duplicates("playerId").set_index("playerId")["mv_eur"]


# --------------------------------------------------------------------------- #
# Naver row → fee-model features.                                              #
# --------------------------------------------------------------------------- #

def _season_rows(players: pd.DataFrame) -> pd.DataFrame:
    """One row per (playerId, season): the max-minutes league row if he moved."""
    p = players.copy()
    p["minsPlayed"] = pd.to_numeric(p["minsPlayed"], errors="coerce").fillna(0)
    p = p.sort_values("minsPlayed", ascending=False).drop_duplicates(["playerId", "season"])
    return p.reset_index(drop=True)


def _features(rows: pd.DataFrame, prior_mv: pd.Series, art: ss.Artifacts) -> pd.DataFrame:
    """Model input for valuing each player at the END of his season."""
    f = lambda c: pd.to_numeric(rows[c], errors="coerce")
    mins = f("minsPlayed")
    per90 = 90.0 / mins.where(mins >= _MIN_MINUTES)
    goals, ast, xg, xa = f("goals"), f("assists"), f("expectedGoals"), f("expectedAssists")
    sot, sh = f("shotsOnTarget"), f("shots")
    passes, acc = f("passes"), f("accuratePasses")
    end = pd.to_datetime((rows["season"] + 1).astype(str) + "-06-01")
    age = (end - pd.to_datetime(rows["dateOfBirth"], errors="coerce")).dt.days / 365.25

    out = pd.DataFrame(index=rows.index)
    out["prior_market_value_eur"] = prior_mv.values / float(art.deflator.deflator[str(SEED_SEASON)])
    out["age_years"] = age
    out["peak_distance"] = (age - 27.0).abs()
    pos = rows["position"].map(_POS).fillna("MF")
    out["pos_forward"] = (pos == "FW").astype(float)
    out["pos_midfielder"] = (pos == "MF").astype(float)
    out["pos_defender"] = (pos == "DF").astype(float)
    out["season_numeric"] = (rows["season"] + 1).astype(float)
    for code, col in _LEAGUE_FLAG.items():
        out[col] = (rows["league"] == code).astype(float)

    played = mins >= _MIN_MINUTES   # no-signal seasons → NaN → training medians
    stat = {
        "MP_Playing": f("matchesPlayed"),
        "Min_Playing": mins,
        "Gls_Per": goals * per90,
        "G+A_Per": (goals + ast) * per90,
        "xAG_Expected": xa,
        "SoT_Standard_shoot": sot,
        "SoT_percent_Standard_shoot": 100 * sot / sh.where(sh > 0),
        "G_per_SoT_Standard_shoot": goals / sot.where(sot > 0),
        "G_minus_xG_Expected_shoot": goals - xg,
        "Cmp_percent_Total_pass": 100 * acc / passes.where(passes > 0),
        "Ast_pass": ast,
    }
    for c, v in stat.items():
        out[c] = v.where(played)
    out["club_2"] = ""
    out["player_nationality"] = ""
    out["team_name"] = ""
    return out


# --------------------------------------------------------------------------- #
# Chain + club ratings.                                                        #
# --------------------------------------------------------------------------- #

def value_chain(players: pd.DataFrame | None = None) -> pd.DataFrame:
    """Per (playerId, season) END-of-season model value, chained season to season.

    Returns columns playerId, season, value_end (EUR), seeded (bool).
    """
    players = load_players() if players is None else players
    art = ss.load_model()
    rows = _season_rows(players)
    seed = seed_values(players)

    last = seed.copy()                    # playerId → latest known value
    out = []
    for s in sorted(rows["season"].unique()):
        r = rows[rows["season"] == s].reset_index(drop=True)
        prior = r["playerId"].map(last)
        median = float(prior.median()) if prior.notna().any() else float(seed.median())
        X = _features(r, prior.fillna(median), art)
        val = pd.Series(ss._model_value_eur(art, X, season=str(SEED_SEASON)), index=r.index).clip(lower=0)
        out.append(pd.DataFrame({"playerId": r["playerId"], "season": s,
                                 "value_end": val, "seeded": r["playerId"].isin(seed.index)}))
        last = pd.concat([last, val.set_axis(r["playerId"])]).groupby(level=0).last()
    return pd.concat(out, ignore_index=True)


def club_ratings(players: pd.DataFrame | None = None,
                 chain: pd.DataFrame | None = None) -> pd.DataFrame:
    """Pre-season value rating per (league, season, teamId).

    value used for season S = the player's latest chain value from seasons < S
    (the 2022/23 TM seed for S=2023); players with none get the league-season
    roster median (unknown = median, as elsewhere).
    """
    players = load_players() if players is None else players
    chain = value_chain(players) if chain is None else chain
    seed = seed_values(players)

    rows = []
    for (lg, s), roster in players.groupby(["league", "season"]):
        hist = chain[chain["season"] < s].sort_values("season").drop_duplicates("playerId", keep="last")
        pre = roster["playerId"].map(hist.set_index("playerId")["value_end"])
        pre = pre.fillna(roster["playerId"].map(seed))
        known = float(pre.notna().mean())
        pre = pre.fillna(float(pre.median()))
        pool = pd.DataFrame({
            "team": roster["teamId"].astype(str).values,
            "club": roster["teamId"].astype(str).values,
            "pos_bucket": roster["position"].map(_POS).fillna("MF").values,
            "model_val": pre.values,
        })
        teams = sorted(pool["team"].unique())
        st = synergy.all_team_strengths(pool, teams, value_col="model_val")
        z = ss._zscore_log(st["strength"].clip(lower=1.0))
        for t in teams:
            rows.append({"league": lg, "season": int(s), "team": t,
                         "strength": float(st.loc[t, "strength"]),
                         "synergy_mult": float(st.loc[t, "synergy_mult"]),
                         "rating": float(z.loc[t]), "known_share": known})
    return pd.DataFrame(rows)
