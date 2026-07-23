"""The breakout multiplier: turn WC spotlight into a market-value JUMP (V0 -> V1).

The fee model is a static point estimator with no temporal "jump" target, so the
jump is constructed here. Design (see METHODOLOGY in README):

  M = 1 + K * spotlight * youth_factor * ceiling_factor          (clipped to [1, M_MAX])

  spotlight       = P * (1 + AMP_E * E)   — individual performance P is the PRIMARY
                    driver; nation exposure E only amplifies it. P=0 => no jump, so a
                    fringe squaddie on the champion does not float up; a breakout needs
                    individual spotlight (goals/assists/rating/award or a curated move).
  youth_factor    — younger converts spotlight into a bigger % jump (James was 22)
  ceiling_factor  — a player already valued near the top has little room to rise
                    (this is why Mbappe, the tournament's best, barely "jumps")

  V0 = model-implied pre-WC value (fee model on 2025/26 club form, re-inflated to
       2026-EUR). V1 = V0 * M. jump_eur = V1 - V0.

Only the LEVEL K is calibrated (to the James-2014 anchor, ~1.67x); the factor
shapes are fixed a priori and NOT fit to the 2026 movers, which are held out for
validation. This mirrors kbo/src/salary_model.py's calibrate-level-not-slope rule.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from worldcup.src import squad_strength_v2 as ssv2  # noqa: E402

# --- multiplier constants (the model's only tunables) ----------------------- #
AMP_E = 0.50       # how much a deep nation run amplifies individual performance P
K = 0.49           # LEVEL scale, calibrated so a James-2014 profile -> ~1.67x
M_MAX = 2.60       # hard cap on the multiplier (no absurd jumps)
CEILING_EUR = 180_000_000.0   # value near which headroom -> 0 (top of the market)
YOUTH_PEAK_AGE = 26.0         # age at which youth_factor == 1.0
YOUTH_SCALE = 8.0             # years; younger raises the factor, older lowers it
YOUTH_MIN, YOUTH_MAX = 0.5, 1.8
CEIL_FLOOR = 0.15            # minimum ceiling_factor (even a maxed player can nudge)
# Board hygiene: ignore fringe players whose model value is negligible.
MIN_V0_EUR = 3_000_000.0

# --- star board (recognizable-player-first ordering) ------------------------ #
# The board is ranked by a HYBRID star score, not pure value-jump: a famous player
# who performed (Mbappé, Yamal, Bellingham) leads even though he barely "jumps",
# while a young riser with a real value jump still surfaces in the upper-middle.
#   star = (N_BASE + (1-N_BASE)*notability) * (W_PERF*P + W_JUMP*jump_norm + W_MV*mv_norm)
STAR_N_BASE = 0.40             # notability floor (0 = ignore fame, 1 = fame is a hard gate)
STAR_W_PERF = 0.60             # WC individual performance P dominates
STAR_W_JUMP = 0.28             # normalized value jump (rewards breakouts)
STAR_W_MV = 0.12               # normalized market value (a soft floor for elite names)
STAR_MV_CEIL = 200_000_000.0   # market value at which mv_norm saturates
# A player needs SOME spotlight to make the board: real performance, or enough name
# value that people expect to see him (a champion's recognizable starter).
STAR_MIN_P = 0.08
STAR_MIN_NOTABILITY = 0.55

# --- transfer likelihood (drop settled stars who won't move) ----------------- #
# A star already anchored at a super-club with no transfer link is a low-probability
# mover — this feature is "who moves and where", so those are excluded. A rumor is
# hard evidence of a move; absent one, likelihood comes from movability (headroom +
# value jump + youth) with a heavy penalty for already being at the top of the market.
SUPERCLUBS_CURRENT = {"Real Madrid", "Barcelona", "FC Barcelona", "Manchester City",
                      "Bayern Munich", "Paris Saint-Germain", "Liverpool", "Liverpool FC"}
TRANSFER_MIN = 0.55           # keep a player only if transfer_likelihood >= this
SUPERCLUB_STAY_PENALTY = 0.35  # a settled super-club star's movability is heavily discounted


def youth_factor(age: float) -> float:
    if not np.isfinite(age) or age <= 0:
        return 1.0
    return float(np.clip((YOUTH_PEAK_AGE - age) / YOUTH_SCALE + 1.0, YOUTH_MIN, YOUTH_MAX))


def ceiling_factor(v_model_eur: float) -> float:
    return float(np.clip(1.0 - v_model_eur / CEILING_EUR, CEIL_FLOOR, 1.0))


def spotlight(E: float, P: float) -> float:
    return float(P) * (1.0 + AMP_E * float(E))


def multiplier(E: float, P: float, age: float, v_model_eur: float, k: float = K) -> float:
    m = 1.0 + k * spotlight(E, P) * youth_factor(age) * ceiling_factor(v_model_eur)
    return float(np.clip(m, 1.0, M_MAX))


def _dedup(pool: pd.DataFrame) -> pd.DataFrame:
    """One row per normalized name (Stathead has multi-team dupes); keep most minutes."""
    if "_k" not in pool.columns:
        return pool
    sort_col = "Min_Playing" if "Min_Playing" in pool.columns else "mv_eur"
    return (pool.sort_values(sort_col, ascending=False)
                .drop_duplicates("_k", keep="first")
                .reset_index(drop=True))


def compute_board(pool: pd.DataFrame, art, k: float = K) -> pd.DataFrame:
    """Attach V0 (model value), M, V1, jump_eur, breakout_score. Returns sorted desc.

    `pool` must already carry E and P (from tournament_data.attach_signals) and the
    columns worldcup's squad_strength_v2 model input needs.
    """
    pool = _dedup(pool)
    model_v0 = ssv2.player_model_values_2526(art, pool).clip(lower=0.0)
    pool["v0_model"] = model_v0.values
    # V0 = curated 2026 TM market value where we have one (realistic baseline for
    # young risers the model undervalues), else the model value. Disclosed in report.
    if "mv_2026" in pool.columns:
        pool["V0"] = pool["mv_2026"].where(pool["mv_2026"].notna(), pool["v0_model"])
        pool["v0_source"] = pool["mv_2026"].notna().map({True: "curated_tm_2026", False: "model"})
    else:
        pool["V0"] = pool["v0_model"]
        pool["v0_source"] = "model"

    pool["youth_f"] = pool["age_years"].map(youth_factor)
    pool["ceiling_f"] = pool["V0"].map(ceiling_factor)
    pool["spotlight"] = pool["P"] * (1.0 + AMP_E * pool["E"])
    pool["M"] = (1.0 + k * pool["spotlight"] * pool["youth_f"] * pool["ceiling_f"]).clip(1.0, M_MAX)
    pool["V1"] = pool["V0"] * pool["M"]
    pool["jump_eur"] = pool["V1"] - pool["V0"]
    # Breakout score: reward a big multiplier on a non-trivial base, so a young
    # riser outranks both a maxed-out superstar (small M) and a fringe nobody
    # (tiny base). sqrt(V0) keeps a €25M->€46M breakout above a €3M->€6M unknown.
    pool["breakout_score"] = (pool["M"] - 1.0) * np.sqrt(pool["V0"].clip(lower=0.0))

    # Star score: recognizable performers first, breakouts rewarded (see constants).
    if "notability" not in pool.columns:
        pool["notability"] = 0.35
    pool["notability"] = pool["notability"].fillna(0.35)
    jump_norm = ((pool["M"] - 1.0) / (M_MAX - 1.0)).clip(0.0, 1.0)
    mv_norm = (pool["V0"] / STAR_MV_CEIL).clip(0.0, 1.0)
    fame = STAR_N_BASE + (1.0 - STAR_N_BASE) * pool["notability"]
    pool["star_score"] = fame * (STAR_W_PERF * pool["P"]
                                 + STAR_W_JUMP * jump_norm
                                 + STAR_W_MV * mv_norm)

    # Transfer likelihood: rumor => high; else movability, penalized hard for a
    # settled super-club star (see constants). Used to drop low-probability movers.
    age = pool["age_years"].fillna(27.0)
    youth_move = ((28.0 - age) / 12.0).clip(0.0, 1.0)
    base_move = 0.55 * pool["ceiling_f"] + 0.25 * jump_norm + 0.20 * youth_move
    at_super = pool["club"].astype(str).isin(SUPERCLUBS_CURRENT)
    lk = base_move.where(~at_super, base_move * SUPERCLUB_STAY_PENALTY).clip(0.0, 1.0)
    status = pool.get("mover_status")
    if status is not None:
        lk = lk.mask(status == "rumored", 0.85).mask(status == "confirmed", 1.0)
    pool["transfer_likelihood"] = lk

    board = pool[pool["V0"] >= MIN_V0_EUR].copy()
    return board.sort_values("star_score", ascending=False).reset_index(drop=True)


# --- 하메스 (James Rodriguez) archetype pick -------------------------------- #
# A young attacker/creator who broke out on a deep-ish run and is not already a
# maxed-out superstar — the profile that turns a tournament into a super-club move.
_ATTACK_BUCKETS = {"FW", "MF"}


def james_score(row) -> float:
    age = float(row["age_years"]) if np.isfinite(row["age_years"]) else 27.0
    young = float(np.clip((26.0 - age) / 8.0, 0.0, 1.0))          # 0 at 26+, 1 at 18-
    attack = 1.0 if str(row.get("pos_bucket", "")) in _ATTACK_BUCKETS else 0.45
    perf = float(row["P"])
    run = float(row["E"])
    mult = float(np.clip((row["M"] - 1.0) / (M_MAX - 1.0), 0.0, 1.0))
    room = float(row["ceiling_f"])
    return (0.30 * young + 0.24 * perf + 0.16 * run + 0.16 * mult + 0.14 * room) * attack


def james_pick(board: pd.DataFrame) -> pd.Series:
    scored = board.assign(_james=board.apply(james_score, axis=1))
    return scored.sort_values("_james", ascending=False).iloc[0]
