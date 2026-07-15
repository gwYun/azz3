"""Matchup export (야구 승부 예측) — per-player ingredients for the in-browser simulator.

The `/matchup` tab predicts a single game between two teams. Unlike the season model
(`run_bottomup.py`), it must be **order-sensitive**: batting order, not just which nine
start, has to move the win probability so a "win-max lineup" is meaningful. The heavy
part (a base-out Markov run model) runs in the browser; this module exports the
*ingredients* it needs, all derived in-house from the real full-roster /Record data
(`data.player_batting_full` / `player_pitching_full`, fetched by iterating the team
filter — so even 키움, with zero qualified batters, contributes its real 39-man roster):

  * per-PA event rates {BB,1B,2B,3B,HR,OUT} for every batter (lightly shrunk to league
    by playing time so a 10-PA bench bat doesn't read as a .300 hitter),
  * per-BF allowed rates for each starter + an IP-weighted bullpen composite (+ an elite
    high-leverage subset),
  * a modeled 5-man rotation (order advanced client-side so a starter isn't reused in
    back-to-back games — real probable-pitcher feeds live behind the robots-blocked
    /ws/ API and are not scraped),
  * a heuristic projected ("예상") batting order, and a per-team calibration scalar so a
    team's projected lineup vs a league-average pitcher reproduces its `rs_per_game`
    from `team_build.build_team_ratings` (keeps `/matchup` consistent with `/kbo`).

`markov_expected_runs` here is the DETERMINISTIC reference of the TypeScript engine
(`web/lib/matchup-sim.ts`); `tests/test_kbo_v2.py` pins them to parity. Positions aren't
on the /Record pages, so the lineup is playing-time/value ordered, not positionally
legal — disclosed; the offensive sim doesn't need fielding positions.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config, data, league_constants as lc, player_value as pv, salary_model
from . import team_build as tbuild
from .game_model import DISPERSION_K, HOME_FACTOR

# Event order shared with the TS engine. OUT is last (index 5).
EVENTS = ["bb", "b1", "b2", "b3", "hr", "out"]
_OUT = 5

# Shrinkage priors (pseudo-PA / pseudo-BF pulled toward league) — stabilize small samples.
K_BAT = 120.0
K_PIT = 180.0
# Roster shaping.
POOL_SIZE = 14          # batters exported per team (9 starters + bench for the optimizer)
ROTATION = 5
_SIM_PARAMS = dict(breadth=6.0, mode="actual", wexp_weight=0.04, tactics_weight=1.0, fip_blend=0.25)

# Base-out advancement table: _ADV[state][e] = (new_state, runs), state bit0=1B,1=2B,2=3B.
# Deterministic, no double plays / first-to-third variance (v1, disclosed); the per-team
# calibration scalar absorbs the resulting run-level bias.
def _build_adv():
    adv = [[None] * 5 for _ in range(8)]
    for st in range(8):
        r1, r2, r3 = st & 1, (st >> 1) & 1, (st >> 2) & 1
        # BB (e=0): batter to 1B, force only.
        runs = 1 if (r1 and r2 and r3) else 0
        n3 = 1 if (r1 and r2) else r3
        n2 = 1 if r1 else r2
        adv[st][0] = ((1 | (n2 << 1) | (n3 << 2)), runs)
        # 1B (e=1): batter->1B, runner 1B->2B, runners on 2B/3B score (standard aggressive
        # single: a runner scores from second on a single ~most of the time).
        adv[st][1] = ((1 | (r1 << 1)), r2 + r3)
        # 2B (e=2): batter->2B, runner 1B->3B, runners on 2B/3B score.
        adv[st][2] = (((1 << 1) | (r1 << 2)), r2 + r3)
        # 3B (e=3): batter->3B, everyone scores.
        adv[st][3] = ((0 | (0 << 1) | (1 << 2)), r1 + r2 + r3)
        # HR (e=4): everyone + batter scores.
        adv[st][4] = (0, r1 + r2 + r3 + 1)
    return adv


_ADV = _build_adv()
_PA_CAP = 150   # plate appearances to drain the 9-inning state distribution


# --------------------------------------------------------------------------- #
# Rates.                                                                       #
# --------------------------------------------------------------------------- #
def league_event_rates(c: dict) -> dict:
    """League per-PA rates + the non-HR hit split (from team-season totals)."""
    tb = data.team_batting(c["season"])
    tot = {k: float(tb[k].sum()) for k in ["PA", "B1", "B2", "B3", "HR", "BB", "HBP"]}
    pa = tot["PA"]
    raw = {"bb": (tot["BB"] + tot["HBP"]) / pa, "b1": tot["B1"] / pa,
           "b2": tot["B2"] / pa, "b3": tot["B3"] / pa, "hr": tot["HR"] / pa}
    raw["out"] = 1.0 - sum(raw.values())
    nonhr = tot["B1"] + tot["B2"] + tot["B3"]
    split = {"b1": tot["B1"] / nonhr, "b2": tot["B2"] / nonhr, "b3": tot["B3"] / nonhr}
    return {"event": raw, "hit_split_nonhr": split}


def _shrink(raw: dict, n: float, lg: dict, k: float) -> dict:
    """Blend raw per-PA rates toward league (sum stays 1: both sides are simplexes)."""
    return {e: round((raw[e] * n + lg[e] * k) / (n + k), 6) for e in EVENTS}


def batter_rates(row: pd.Series, lg: dict) -> dict | None:
    pa = float(row["PA"])
    if pa <= 0:
        return None
    raw = {"bb": (row["BB"] + row["HBP"]) / pa, "b1": row["B1"] / pa,
           "b2": row["B2"] / pa, "b3": row["B3"] / pa, "hr": row["HR"] / pa}
    raw["out"] = max(0.0, 1.0 - sum(raw.values()))
    return _shrink(raw, pa, lg["event"], K_BAT)


def pitcher_rates(row: pd.Series, lg: dict) -> dict | None:
    ip = float(row["IP"])
    tbf = row.get("TBF", float("nan"))
    bf = float(tbf) if pd.notna(tbf) and float(tbf) > 0 else 3 * ip + float(row["H"]) + float(row["BB"]) + float(row["HBP"])
    if bf <= 0:
        return None
    hr = float(row["HR"]) / bf
    bb = (float(row["BB"]) + float(row["HBP"])) / bf
    hits = float(row["H"]) / bf
    nonhr = max(0.0, hits - hr)
    sp = lg["hit_split_nonhr"]
    raw = {"bb": bb, "b1": nonhr * sp["b1"], "b2": nonhr * sp["b2"], "b3": nonhr * sp["b3"], "hr": hr}
    raw["out"] = max(0.0, 1.0 - bb - hits)
    s = sum(raw.values()) or 1.0
    raw = {e: raw[e] / s for e in EVENTS}
    return _shrink(raw, bf, lg["event"], K_PIT)


def _composite_rates(df: pd.DataFrame, lg: dict) -> dict:
    """IP-weighted composite of a group of pitchers -> one rate vector + FIP."""
    if df.empty:
        return {"fip": round(_LG_FIP, 2), "rates": {e: lg["event"][e] for e in EVENTS}}
    w = df["IP"].clip(lower=1e-6).to_numpy()
    vecs = np.array([[r[e] for e in EVENTS] for r in df["_rates"]])
    comp = (w[:, None] * vecs).sum(axis=0) / w.sum()
    fip = float((w * df["FIP"].to_numpy()).sum() / w.sum())
    return {"fip": round(fip, 2), "rates": {e: round(float(comp[i]), 6) for i, e in enumerate(EVENTS)}}


# --------------------------------------------------------------------------- #
# Staff + lineup construction.                                                 #
# --------------------------------------------------------------------------- #
def classify_staff(pit_valued: pd.DataFrame, lg: dict) -> dict:
    """Real 5-man rotation + bullpen composite + elite subset from the full staff."""
    p = pit_valued[pit_valued["IP"] > 0].copy()
    p["_rates"] = [pitcher_rates(r, lg) for _, r in p.iterrows()]
    p = p[p["_rates"].notna()]
    p["ipg"] = p["IP"] / p["G"].clip(lower=1)
    cand = p[(p["ipg"] >= 3.0) & (p["IP"] >= 20)].sort_values("IP", ascending=False)
    rot = cand.head(ROTATION)
    if len(rot) < ROTATION:                                   # thin staff: fill by workload
        extra = p[~p.index.isin(rot.index)].sort_values("IP", ascending=False).head(ROTATION - len(rot))
        rot = pd.concat([rot, extra])
    pen = p[~p.index.isin(rot.index)]
    elite = pen[pen["IP"] >= 10].sort_values("FIP").head(3)
    rotation = [{"name": str(r["name"]), "gs": int(r["G"]),
                 "sp_innings": round(float(np.clip(r["ipg"], 4.5, 6.5)), 2),
                 "fip": round(float(r["FIP"]), 2), "rates": r["_rates"]}
                for _, r in rot.iterrows()]
    return {"rotation": rotation,
            "bullpen": _composite_rates(pen, lg),
            "bullpen_elite": _composite_rates(elite if not elite.empty else pen, lg)}


def _batting_order(pool: list[dict]) -> list[int]:
    """Heuristic manager lineup over the 9 starters (indices 0..8 of the PA-sorted pool)."""
    idx = list(range(9))
    onbase = {i: 1.0 - pool[i]["rates"]["out"] for i in idx}
    power = {i: pool[i]["rates"]["b2"] + 2 * pool[i]["rates"]["b3"] + 3 * pool[i]["rates"]["hr"] for i in idx}
    value = {i: pool[i]["wrc_plus"] for i in idx}
    rem = set(idx)

    def take(metric):
        j = max(rem, key=lambda i: metric[i])
        rem.discard(j)
        return j

    lead = take(onbase)
    cleanup = take(power)
    three = take(value)
    two = take(onbase)
    five = take(power)
    rest = sorted(rem, key=lambda i: -value[i])
    return [lead, two, three, cleanup, five, *rest]


# --------------------------------------------------------------------------- #
# Base-out Markov expected runs — DETERMINISTIC reference of matchup-sim.ts.   #
# --------------------------------------------------------------------------- #
def _matchup_dist(bvec, pvec, lgvec):
    raw = [bvec[e] * pvec[e] / lgvec[e] if lgvec[e] > 0 else 0.0 for e in range(6)]
    s = sum(raw) or 1.0
    return [x / s for x in raw]


def markov_expected_runs(order, sp, pen, lg_event, sp_innings, home,
                         elite=None, calib=1.0):
    """Expected runs over 9 innings for an ordered lineup vs a starter/bullpen pair.

    `order` = 9 rate-dicts (batting order). `sp`/`pen`/`elite` = pitcher rate-dicts.
    Innings 1..T use the starter, T+1..9 the bullpen; inning 9 uses `elite` if given
    (the leverage toggle). Batter for the k-th plate appearance is (k mod 9) — the
    lineup pointer carries across innings, which is the source of order effects.
    """
    lgv = [lg_event[e] for e in EVENTS]
    ov = [[b[e] for e in EVENTS] for b in order]
    spv = [sp[e] for e in EVENTS]
    penv = [pen[e] for e in EVENTS]
    m_sp = [_matchup_dist(ov[b], spv, lgv) for b in range(9)]
    m_pen = [_matchup_dist(ov[b], penv, lgv) for b in range(9)]
    if elite is not None:
        elv = [elite[e] for e in EVENTS]
        m_el = [_matchup_dist(ov[b], elv, lgv) for b in range(9)]
    starter_innings = int(round(min(max(sp_innings, 4), 7)))

    # P[inning][state][outs], innings 1..9.
    P = [[[0.0] * 3 for _ in range(8)] for _ in range(10)]
    P[1][0][0] = 1.0
    mu = 0.0
    for k in range(_PA_CAP):
        b = k % 9
        newP = [[[0.0] * 3 for _ in range(8)] for _ in range(10)]
        step = 0.0
        active = 0.0
        for inning in range(1, 10):
            if inning <= starter_innings:
                M = m_sp[b]
            elif elite is not None and inning == 9:
                M = m_el[b]
            else:
                M = m_pen[b]
            for st in range(8):
                for outs in range(3):
                    p = P[inning][st][outs]
                    if p == 0.0:
                        continue
                    active += p
                    for e in range(6):
                        pe = M[e]
                        if pe == 0.0:
                            continue
                        mass = p * pe
                        if e == _OUT:
                            if outs == 2:
                                if inning < 9:
                                    newP[inning + 1][0][0] += mass    # inning over -> next
                            else:
                                newP[inning][st][outs + 1] += mass
                        else:
                            ns, runs = _ADV[st][e]
                            step += mass * runs
                            newP[inning][ns][outs] += mass
        mu += step
        P = newP
        if active < 1e-9:
            break
    return mu * calib * (HOME_FACTOR if home else 1.0)


# --------------------------------------------------------------------------- #
# Assembly.                                                                    #
# --------------------------------------------------------------------------- #
_LG_FIP = 4.5   # replaced per-season in assemble_matchup


def _team_batters(bat_valued: pd.DataFrame, lg: dict) -> tuple[list[dict], list[int]]:
    b = bat_valued[bat_valued["PA"] > 0].sort_values("PA", ascending=False).head(POOL_SIZE)
    pool = []
    for _, r in b.iterrows():
        rates = batter_rates(r, lg)
        if rates is None:
            continue
        pool.append({"name": str(r["name"]), "pa": int(r["PA"]),
                     "wrc_plus": round(float(r["wRC_plus"]), 0), "war": round(float(r["WAR"]), 1),
                     "rates": rates})
    order = _batting_order(pool) if len(pool) >= 9 else list(range(len(pool)))
    return pool, order


def build_team_matchup(code: str, ratings: pd.DataFrame, bat_valued: pd.DataFrame,
                       pit_valued: pd.DataFrame, c: dict, lg: dict) -> dict:
    row = ratings.loc[code]
    pool, order = _team_batters(bat_valued, lg)
    staff = classify_staff(pit_valued, lg)
    # Calibrate so projected lineup vs a league-average pitcher == team rs_per_game.
    order_vecs = [pool[i]["rates"] for i in order[:9]]
    base = markov_expected_runs(order_vecs, lg["event"], lg["event"], lg["event"],
                                sp_innings=6, home=False, calib=1.0)
    calib = round(float(row["rs_per_game"]) / base, 4) if base > 0 else 1.0
    return {
        "code": code, "ko": data.TEAM_KO[code], "en": data.TEAM_EN[code],
        "park": data.TEAM_PARK[code],
        "rs_per_game": round(float(row["rs_per_game"]), 2),
        "ra_per_game": round(float(row["ra_per_game"]), 2),
        "off_rating": round(float(row["off_rating"]), 0),
        "def_rating": round(float(row["def_rating"]), 0),
        "mu_calib": calib,
        "batters": pool, "lineup_projected": order,
        "rotation": staff["rotation"], "bullpen": staff["bullpen"],
        "bullpen_elite": staff["bullpen_elite"],
    }


def assemble_matchup(season: int = config.CURRENT_SEASON) -> dict:
    global _LG_FIP
    c = lc.compute_constants(season)
    _LG_FIP = c["lg_FIP"]
    lg = league_event_rates(c)

    bat = data.player_batting_full(season).copy()
    pit = data.player_pitching_full(season).copy()
    # Full rosters carry bench edge rows (0-PA call-ups, blank Basic2 cells); clean to
    # numeric and keep only players who actually appeared, so valuation stays finite.
    for col in ["PA", "AB", "H", "B1", "B2", "B3", "HR", "BB", "IBB", "HBP", "SF", "SO", "R"]:
        if col in bat:
            bat[col] = pd.to_numeric(bat[col], errors="coerce").fillna(0.0)
    for col in ["IP", "G", "H", "HR", "BB", "HBP", "SO", "R", "ER", "TBF", "SV", "HLD"]:
        if col in pit:
            pit[col] = pd.to_numeric(pit[col], errors="coerce").fillna(0.0)
    bat = bat[bat["PA"] > 0].copy()
    pit = pit[pit["IP"] > 0].copy()
    bat["position"] = "IF"                                  # /Record carries no position
    pit["role"] = np.where(pit["IP"] / pit["G"].clip(lower=1) > 4.0, "SP", "RP")

    bv = pv.batter_value(bat, c)
    bv["WAR"] = bv["WAR"].fillna(0.0)
    bv["wRC_plus"] = bv["wRC_plus"].fillna(0.0)
    pv_ = pv.pitcher_value(pit, c)
    pv_["WAR"] = pv_["WAR"].fillna(0.0)
    values = {"batters": salary_model.add_salary(bv), "pitchers": salary_model.add_salary(pv_)}
    ratings = tbuild.build_team_ratings(season, constants=c, values=values, **_SIM_PARAMS)

    teams = []
    for code in data.TEAM_CODES:
        bt = values["batters"][values["batters"]["franchise"] == code]
        pt = values["pitchers"][values["pitchers"]["franchise"] == code]
        teams.append(build_team_matchup(code, ratings, bt, pt, c, lg))
    teams.sort(key=lambda t: -t["off_rating"])
    return {
        "version": "v1-matchup", "season": str(season),
        "method": "base-out Markov 기대득점(타순 반영) → NegBinom 맞대결; log5 타자×투수 매치업",
        "league": {"lg_R_per_G": c["lg_R_per_G"], "k": DISPERSION_K, "home_factor": HOME_FACTOR,
                   "event": {e: round(lg["event"][e], 6) for e in EVENTS},
                   "hit_split_nonhr": {k: round(v, 6) for k, v in lg["hit_split_nonhr"].items()}},
        "teams": teams,
        "caveat": ("실제 로스터·성적(전 구단 전체 선수) 기반. 타순·선발 로테이션은 모델링(실제 "
                   "라인업/예고선발은 robots 차단된 /ws/ API에만 있어 미사용). 포지션 미제공 → "
                   "라인업은 출전·가치순. statiz 미사용."),
    }


if __name__ == "__main__":
    import json
    payload = assemble_matchup()
    print(f"teams: {len(payload['teams'])}")
    for t in payload["teams"][:3]:
        print(f"  {t['ko']}: rs={t['rs_per_game']} calib={t['mu_calib']} "
              f"batters={len(t['batters'])} rotation={len(t['rotation'])}")
    print(json.dumps(payload["teams"][0]["batters"][0], ensure_ascii=False))
