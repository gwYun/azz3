"""ValueTrack — KBO season + Korean Series prediction (orchestrator).

Stage 1 (per-franchise offense/defense projection from the last 3 completed seasons)
-> Stage 2 (Monte-Carlo of the 144-game regular season + the postseason stepladder)
-> kbo.json + a Korean report + a timestamped, commit-stamped audit entry. The KBO
sibling of pl/scripts/run_prediction, with the same honesty contract:

  * Method is pre-registered: in-house sabermetrics -> Marcel team projection ->
    NegBinom run model -> simulate. Nothing is tuned to crown a chosen team.
  * The forecast is forward-looking, made TODAY for the named season; run_id (UTC) +
    model_commit make the run date provable.
  * Whatever the simulation says is reported as-is, plus a transparent sensitivity
    grid (projection weight + season-strength uncertainty) so it can't be cherry-picked.

Run:  python -m kbo.scripts.run_prediction --sims 1000000
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from kbo.src import config, data, league_constants as lc
from kbo.src import game_model as gm
from kbo.src import team_strength_kbo as ts
from kbo.src import postseason as post
from kbo.src.season_simulate import Season

_OUT = config.OUTPUTS_DIR
_WEB_PUBLIC = config.PROJECT_ROOT / "web" / "public" / "kbo.json"

# Pre-registered baseline (mirrors pl's 0.45/0.55 blend; here projection vs last-year).
_BASE_PROJ_W = 0.6
_BASE_PRIOR_W = 0.4
_BASE_REGRESS = 0.30
_BASE_RATING_SD = 0.0   # raw; season-strength uncertainty is a sensitivity axis


def _git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=str(config.PROJECT_ROOT)
        ).decode().strip()
    except Exception:
        return "unknown"


def _lg_rg(forecast_season: int) -> float:
    """League runs/game anchor = most recent completed season."""
    return lc.compute_constants(forecast_season - 1)["lg_R_per_G"]


def run_one(forecast_season: int, proj_w: float, prior_w: float, regress: float,
            sims: int, seed: int, chunk: int, rating_sd: float):
    ratings = ts.build_team_ratings(forecast_season, proj_w=proj_w, prior_w=prior_w,
                                    regress=regress)
    rs = ratings["rs_per_game"].to_dict()
    ra = ratings["ra_per_game"].to_dict()
    lg_rg = _lg_rg(forecast_season)

    def pfn(rng, seeds, sim_rs, sim_ra):
        return post.simulate_postseason(rng, seeds, sim_rs, sim_ra, lg_rg)

    sea = Season(rs, ra, lg_rg, seed=seed, rating_sd=rating_sd)
    out = sea.run(sims, chunk=chunk, postseason_fn=pfn)
    return ratings, out


def _ranked(prob: dict) -> list[str]:
    return [t for t, _ in sorted(prob.items(), key=lambda x: -x[1])]


def build_sensitivity(forecast_season, sims, seed, chunk) -> list[dict]:
    """Transparent grid: champion + its prob under each defensible variant."""
    grid = []
    for pw in (0.30, 0.45, 0.60, 0.75, 0.90):
        _, out = run_one(forecast_season, pw, 1 - pw, _BASE_REGRESS, sims, seed, chunk, 0.0)
        champ = _ranked(out["champion_prob"])[0]
        grid.append({"axis": "projection_weight", "proj_w": pw, "rating_sd": 0.0,
                     "champion_en": data.TEAM_EN[champ], "champion_ko": data.TEAM_KO[champ],
                     "champion_prob": round(out["champion_prob"][champ], 4)})
    for sd in (0.03, 0.05, 0.07):
        _, out = run_one(forecast_season, _BASE_PROJ_W, _BASE_PRIOR_W, _BASE_REGRESS,
                         sims, seed, chunk, sd)
        champ = _ranked(out["champion_prob"])[0]
        grid.append({"axis": "season_uncertainty", "proj_w": _BASE_PROJ_W, "rating_sd": sd,
                     "champion_en": data.TEAM_EN[champ], "champion_ko": data.TEAM_KO[champ],
                     "champion_prob": round(out["champion_prob"][champ], 4)})
    return grid


def build_seed_stability(forecast_season, sims, chunk, seeds=(42, 1, 7)) -> list[dict]:
    rows = []
    for s in seeds:
        _, out = run_one(forecast_season, _BASE_PROJ_W, _BASE_PRIOR_W, _BASE_REGRESS,
                         sims, s, chunk, 0.0)
        champ = _ranked(out["champion_prob"])[0]
        rows.append({"seed": s, "champion_en": data.TEAM_EN[champ],
                     "champion_prob": round(out["champion_prob"][champ], 4)})
    return rows


def assemble(forecast_season, ratings, out, sensitivity, seed_stability, sims, seed) -> dict:
    champ_prob = out["champion_prob"]
    ranked = _ranked(champ_prob)
    pick = ranked[0]
    teams = []
    for rank, code in enumerate(ranked, 1):
        row = ratings.loc[code]
        teams.append({
            "en": data.TEAM_EN[code], "ko": data.TEAM_KO[code], "rank": rank,
            "championship": round(champ_prob[code] * 100, 2),
            "pennant": round(out["pennant_prob"][code] * 100, 1),
            "playoff": round(out["playoff_prob"][code] * 100, 1),
            "first": round(out["first_prob"][code] * 100, 1),
            "off_rating": round(float(row["off_rating"]), 1),
            "def_rating": round(float(row["def_rating"]), 1),
            "proj_wins": round(out["mean_wins"][code], 1),
            "rs_per_game": round(float(row["rs_per_game"]), 2),
            "ra_per_game": round(float(row["ra_per_game"]), 2),
        })
    return {
        "version": "v1",
        "season": str(forecast_season),
        "run_id": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_commit": _git_commit(),
        "n_sims": sims, "seed": seed,
        "params": {"proj_w": _BASE_PROJ_W, "prior_w": _BASE_PRIOR_W,
                   "regress": _BASE_REGRESS, "rating_sd": _BASE_RATING_SD,
                   "home_factor": gm.HOME_FACTOR, "dispersion_k": gm.DISPERSION_K},
        "title_pick": {"en": data.TEAM_EN[pick], "ko": data.TEAM_KO[pick],
                       "prob": round(champ_prob[pick] * 100, 2)},
        "caveat": ("독립적인 경기 노이즈는 시즌 단위 결과 분산을 과소평가하므로 1순위의 "
                   "우승 확률은 다소 과대평가됩니다. 표는 랭킹으로 읽고, 시즌 불확실성 "
                   "민감도에서 현실적인 분포를 확인하세요. 오늘 시점에 "
                   f"{forecast_season} 시즌을 대상으로 한 전향적 예측입니다(직전 3시즌 입력)."),
        "teams": teams,
        "sensitivity": sensitivity,
        "seed_stability": seed_stability,
    }


def write_report(payload: dict) -> str:
    pick = payload["title_pick"]
    L = []
    L.append(f"# 밸류트랙 — {payload['season']} KBO 한국시리즈 우승 예측 리포트\n\n")
    L.append(f"> 실행 시각(UTC): `{payload['run_id']}` · 모델 커밋: `{payload['model_commit']}` · "
             f"{payload['n_sims']:,}회 시뮬레이션 (시드 {payload['seed']})\n\n")
    L.append("자체 세이버메트릭스(wOBA/wRC+/FIP/WAR, KBO 시즌별 상수로 직접 계산)로 직전 3시즌 "
             "성적을 투영해 각 구단의 공격/수비 전력을 산출하고, 144경기 정규시즌과 "
             "포스트시즌 사다리(와일드카드→준PO→PO→한국시리즈)를 몬테카를로로 시뮬레이션했습니다. "
             "statiz를 크롤링하지 않고 공개 데이터(KBO 공식 기록실 + choosunsick 경기 로그)만 사용합니다.\n\n")
    L.append("## 핵심 결론\n\n")
    L.append(f"- **한국시리즈 우승 1순위: {pick['ko']} ({pick['en']}) — {pick['prob']:.1f}%**\n\n")
    L.append("## 우승 확률 (전체 10개 구단)\n\n")
    L.append("| 순위 | 구단 | 우승 | 한국시리즈 | 가을야구 | 정규1위 | 공격 | 수비 | 예상승수 |\n")
    L.append("|---:|---|---:|---:|---:|---:|---:|---:|---:|\n")
    for c in payload["teams"]:
        L.append(f"| {c['rank']} | {c['ko']} | {c['championship']:.1f}% | {c['pennant']:.0f}% | "
                 f"{c['playoff']:.0f}% | {c['first']:.0f}% | {c['off_rating']:.0f} | "
                 f"{c['def_rating']:.0f} | {c['proj_wins']:.1f} |\n")
    L.append("\n## 민감도 분석 (체리피킹 방지)\n\n")
    L.append("방법론을 사전 고정한 채 방어 가능한 변형(투영 가중치 / 시즌 불확실성)을 휩쓸어 "
             "각 변형의 우승팀과 확률을 그대로 보고합니다.\n\n")
    L.append("| 축 | proj_w | rating_sd | 우승팀 | 우승 확률 |\n|---|---:|---:|---|---:|\n")
    for g in payload["sensitivity"]:
        L.append(f"| {g['axis']} | {g['proj_w']} | {g['rating_sd']} | {g['champion_ko']} | "
                 f"{g['champion_prob']*100:.1f}% |\n")
    L.append("\n## 시드 안정성\n\n| 시드 | 우승팀 | 우승 확률 |\n|---:|---|---:|\n")
    for r in payload["seed_stability"]:
        L.append(f"| {r['seed']} | {r['champion_en']} | {r['champion_prob']*100:.1f}% |\n")
    L.append("\n## 방법론 / 한계\n\n")
    L.append("- **데이터**: KBO 공식 기록실(/Record, robots 허용)의 팀 시즌 합계 + 규정 타석/이닝 "
             "선수 기록, choosunsick/KBO_data 경기 로그. statiz 미사용(robots.txt가 봇 차단).\n")
    L.append("- **세이버메트릭스**: wOBA·wRC+·FIP·WAR를 KBO 시즌별 상수(리그 wOBA·wOBA scale·FIP 상수·"
             "득점환경)로 직접 계산. MLB 상수 미사용.\n")
    L.append("- **전력 산출**: 팀 시즌 합계로 Marcel식 투영(최근시즌 가중 + 평균 회귀) → 공격/수비 "
             "득점률. 선수 단위 합산이 아니므로 시너지 항은 없음.\n")
    L.append("- **경기 모델**: 득점 = 음이항분포(과분산 var/mean≈2.5 반영), 홈 어드밴티지는 홈 "
             "승률 ~0.538에 맞춰 보정.\n")
    L.append("- **한계**: (1) 규정 미달 선수 풀(공식 랭킹은 규정 선수만) → 선수 리더보드는 주전 한정. "
             "(2) 구장 보정 중립(최근 경기 단위 데이터 부재). (3) WAR는 수비/주루/포지션 보정 생략한 "
             "근사치. (4) 독립 경기 노이즈는 시즌 분산을 과소평가 → 1순위 확률 과대.\n")
    return "".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=config.CURRENT_SEASON)
    ap.add_argument("--sims", type=int, default=1_000_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--chunk", type=int, default=25_000)
    ap.add_argument("--sens-sims", type=int, default=100_000)
    ap.add_argument("--no-web-copy", action="store_true")
    args = ap.parse_args()

    _OUT.mkdir(parents=True, exist_ok=True)
    print(f"[Stage 1+2] {args.season} 전력 산출 + {args.sims:,}회 시뮬레이션 …")
    ratings, out = run_one(args.season, _BASE_PROJ_W, _BASE_PRIOR_W, _BASE_REGRESS,
                           args.sims, args.seed, args.chunk, _BASE_RATING_SD)
    ratings.to_csv(_OUT / "stage1_team_ratings.csv")
    pick = _ranked(out["champion_prob"])[0]
    print(f"  -> 우승 1순위 {data.TEAM_KO[pick]} {out['champion_prob'][pick]*100:.1f}%")

    print(f"[Sensitivity] 변형 그리드 ({args.sens_sims:,}회/셀) …")
    sensitivity = build_sensitivity(args.season, args.sens_sims, args.seed, args.chunk)
    print(f"[Seed stability] 시드 42/1/7 ({args.sens_sims:,}회) …")
    seed_stability = build_seed_stability(args.season, args.sens_sims, args.chunk)

    payload = assemble(args.season, ratings, out, sensitivity, seed_stability,
                       args.sims, args.seed)
    (_OUT / "kbo.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
    print(f"  -> {_OUT/'kbo.json'}")
    (config.KBO_DIR / "report.md").write_text(write_report(payload), encoding="utf-8")
    print(f"  -> {config.KBO_DIR/'report.md'}")

    if not args.no_web_copy:
        _WEB_PUBLIC.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_OUT / "kbo.json", _WEB_PUBLIC)
        print(f"  -> {_WEB_PUBLIC} (web copy)")

    audit = {k: payload[k] for k in ("run_id", "model_commit", "season", "n_sims",
                                     "seed", "params", "title_pick")}
    with open(_OUT / "runs.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(audit, ensure_ascii=False) + "\n")

    print(f"\n=== 헤드라인 ===\n우승 1순위 {payload['title_pick']['ko']} "
          f"{payload['title_pick']['prob']:.1f}%")


if __name__ == "__main__":
    main()
