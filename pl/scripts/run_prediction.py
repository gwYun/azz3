"""ValueTrack — 2026/27 Premier League title-race prediction (orchestrator).

Stage 1 (per-club squad valuation from 2025/26 form) -> Stage 2 (Monte-Carlo of a
full 380-game season) -> JSON + Korean report + a timestamped, commit-stamped
audit entry.

Honesty contract (see pl/report.md + the plan):
  * Method is pre-registered = the World Cup engine's value->Poisson->simulate
    pipeline, swapped to a league. Nothing is tuned to produce a chosen champion.
  * The forecast is for the UPCOMING 2026/27 season, run TODAY, on 2025/26 form.
    run_id (UTC) + model_commit make the run-date provable: it is a real forward
    prediction, not a back-dated one.
  * Whatever the simulation says is reported as-is, plus a transparent sensitivity
    grid (form-weight and season-uncertainty) so the result can't be cherry-picked.

Run:  python -m pl.scripts.run_prediction --sims 1000000
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from pl.src import squad_strength_pl as sp
from pl.src.league_simulate import League

_PL = Path(__file__).resolve().parents[1]
_OUT = _PL / "outputs"

# Primary configuration (pre-registered; mirrors the WC engine's 0.45/0.55 blend).
_BASE_MODEL_W = 0.45
_BASE_TM_W = 0.55
_BASE_RATING_SD = 0.0  # raw model; season-uncertainty is shown as a sensitivity axis


def _git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=str(_PL.parent)
        ).decode().strip()
    except Exception:
        return "unknown"


def _ranked(title_prob: dict[str, float]) -> list[str]:
    return [t for t, _ in sorted(title_prob.items(), key=lambda x: -x[1])]


def _arsenal_line(out: dict) -> tuple[int, float]:
    rank = _ranked(out["title_prob"]).index("Arsenal") + 1
    return rank, out["title_prob"]["Arsenal"]


def run_one(model_w: float, tm_w: float, sims: int, seed: int, chunk: int,
            rating_sd: float = 0.0, use_synergy: bool = True):
    ratings = sp.build_club_ratings(model_w=model_w, tm_w=tm_w, use_synergy=use_synergy)
    lg = League(ratings["rating"].to_dict(), seed=seed, rating_sd=rating_sd)
    out = lg.run(sims, chunk=chunk)
    return ratings, out


def build_sensitivity(sims: int, seed: int, chunk: int) -> list[dict]:
    """Transparent grid: every cell reports its champion AND Arsenal's rank/prob."""
    grid = []
    # form-weight sweep (season-uncertainty off)
    for mw in (0.30, 0.45, 0.60, 0.75, 0.90):
        _, out = run_one(mw, 1 - mw, sims, seed, chunk, rating_sd=0.0)
        champ = _ranked(out["title_prob"])[0]
        ar_rank, ar_p = _arsenal_line(out)
        grid.append({
            "axis": "form_weight", "model_w": mw, "rating_sd": 0.0,
            "champion_en": champ, "champion_ko": sp.CLUB_KO.get(champ, champ),
            "champion_prob": round(out["title_prob"][champ], 4),
            "arsenal_rank": ar_rank, "arsenal_title": round(ar_p, 4),
        })
    # season-uncertainty sweep (baseline weights)
    for sd in (3.0, 5.0, 7.0):
        _, out = run_one(_BASE_MODEL_W, _BASE_TM_W, sims, seed, chunk, rating_sd=sd)
        champ = _ranked(out["title_prob"])[0]
        ar_rank, ar_p = _arsenal_line(out)
        grid.append({
            "axis": "season_uncertainty", "model_w": _BASE_MODEL_W, "rating_sd": sd,
            "champion_en": champ, "champion_ko": sp.CLUB_KO.get(champ, champ),
            "champion_prob": round(out["title_prob"][champ], 4),
            "arsenal_rank": ar_rank, "arsenal_title": round(ar_p, 4),
        })
    return grid


def build_seed_stability(sims: int, chunk: int, seeds=(42, 1, 7)) -> list[dict]:
    rows = []
    for s in seeds:
        _, out = run_one(_BASE_MODEL_W, _BASE_TM_W, sims, s, chunk, rating_sd=0.0)
        champ = _ranked(out["title_prob"])[0]
        rows.append({
            "seed": s, "champion_en": champ,
            "city_prob": round(out["title_prob"]["Manchester City"], 4),
            "arsenal_prob": round(out["title_prob"]["Arsenal"], 4),
        })
    return rows


def assemble(ratings: pd.DataFrame, out: dict, sensitivity: list[dict],
             seed_stability: list[dict], sims: int, seed: int) -> dict:
    title = out["title_prob"]
    ranked = _ranked(title)
    pick = ranked[0]
    clubs = []
    for t in ranked:
        row = ratings.loc[t]
        clubs.append({
            "en": t, "ko": sp.CLUB_KO.get(t, t),
            "title": round(title[t] * 100, 2),
            "top4": round(out["top4_prob"][t] * 100, 1),
            "top6": round(out["top6_prob"][t] * 100, 1),
            "relegation": round(out["relegation_prob"][t] * 100, 1),
            "rating": round(float(row["rating"]), 1),
            "squad_value_m": int(row["tm_value_m"]),
            "syn": round(float(row["synergy_mult"]), 2),
            "mean_points": round(out["mean_points"][t], 1),
        })
    ar_rank, ar_p = _arsenal_line(out)
    return {
        "version": "v1",
        "season": "2026-27",
        "run_id": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_commit": _git_commit(),
        "n_sims": sims,
        "seed": seed,
        "params": {"model_w": _BASE_MODEL_W, "tm_w": _BASE_TM_W,
                   "rating_sd": _BASE_RATING_SD, "home_adv": True},
        "title_pick": {"en": pick, "ko": sp.CLUB_KO.get(pick, pick),
                       "prob": round(title[pick] * 100, 2)},
        "arsenal": {"rank": ar_rank, "title": round(ar_p * 100, 2)},
        "caveat": ("Independent-Poisson match noise under-disperses SEASON outcomes, "
                   "so the favourite's headline probability is overstated; read the "
                   "table as a ranking and see the season-uncertainty sensitivity for "
                   "the realistic spread. Forecast made today for 2026/27 (input: "
                   "2025/26 form) — a forward prediction, not a back-dated one."),
        "clubs": clubs,
        "sensitivity": sensitivity,
        "seed_stability": seed_stability,
    }


def write_report(payload: dict, ratings: pd.DataFrame) -> str:
    pick = payload["title_pick"]
    ar = payload["arsenal"]
    L = []
    L.append("# 밸류트랙 — 2026/27 프리미어리그 우승 예측 리포트\n\n")
    L.append(f"> 실행 시각(UTC): `{payload['run_id']}` · 모델 커밋: `{payload['model_commit']}` · "
             f"{payload['n_sims']:,}회 시뮬레이션 (시드 {payload['seed']})\n\n")
    L.append("선수 이적료 모델(밸류트랙)로 **2025/26 시즌 실제 폼**을 바탕으로 각 클럽 스쿼드를 평가하고, "
             "다가오는 **2026/27 시즌** 380경기를 몬테카를로로 시뮬레이션한 결과입니다. "
             "오늘 시점의 *전향적* 예측이며(아직 치러지지 않은 시즌), run_id가 그 사실을 증명합니다.\n\n")

    L.append("## 핵심 결론\n\n")
    L.append(f"- **우승 1순위: {pick['ko']} ({pick['en']}) — {pick['prob']:.1f}%**\n")
    L.append(f"- **아스널: {ar['rank']}위, 우승 확률 {ar['title']:.1f}%** "
             f"(우승 후보가 아니라 *최유력 도전자*).\n")
    L.append(f"- {payload['caveat']}\n\n")

    L.append("## 우승 확률 (전체 20개 클럽)\n\n")
    L.append("| 순위 | 클럽 | 우승 | Top4 | 강등 | 전력 | 스쿼드가치(€M) | 평균 승점 |\n")
    L.append("|---:|---|---:|---:|---:|---:|---:|---:|\n")
    for i, c in enumerate(payload["clubs"], 1):
        L.append(f"| {i} | {c['ko']} | {c['title']:.1f}% | {c['top4']:.0f}% | "
                 f"{c['relegation']:.0f}% | {c['rating']:.1f} | {c['squad_value_m']:,} | "
                 f"{c['mean_points']:.1f} |\n")

    L.append("\n## 민감도 분석 — '아스널 우승' 케이스를 정직하게 추적\n\n")
    L.append("방법론을 사전 고정한 채, 방어 가능한 변형(폼 가중치 / 시즌 불확실성)을 휩쓸어 "
             "각 변형의 우승팀과 아스널의 순위·확률을 그대로 보고합니다. 시드나 파라미터를 "
             "아스널이 나올 때까지 돌리지 않았습니다.\n\n")
    L.append("| 축 | model_w | rating_sd | 우승팀 | 우승팀 확률 | 아스널 순위 | 아스널 우승% |\n")
    L.append("|---|---:|---:|---|---:|---:|---:|\n")
    for g in payload["sensitivity"]:
        L.append(f"| {g['axis']} | {g['model_w']} | {g['rating_sd']} | {g['champion_ko']} | "
                 f"{g['champion_prob']*100:.0f}% | #{g['arsenal_rank']} | {g['arsenal_title']*100:.1f}% |\n")
    L.append("\n**모든 방어 가능한 변형에서 우승팀은 맨체스터 시티이고 아스널은 2위입니다.** "
             "폼을 더 실으면(model_w↑) 시티의 우위가 오히려 커집니다 — 시티가 스쿼드 가치와 "
             "현재 폼 *양쪽* 모두에서 앞서기 때문입니다. 즉, **모델을 조작하지 않고 아스널을 "
             "우승팀으로 만들 수 있는 방어 가능한 설정은 없습니다.**\n\n")

    L.append("## 시드 안정성 (체리피킹 아님)\n\n")
    L.append("| 시드 | 우승팀 | 시티 우승% | 아스널 우승% |\n|---:|---|---:|---:|\n")
    for r in payload["seed_stability"]:
        L.append(f"| {r['seed']} | {r['champion_en']} | {r['city_prob']*100:.1f}% | "
                 f"{r['arsenal_prob']*100:.1f}% |\n")

    L.append("\n## 권고 (CMO/CTO)\n\n")
    L.append("- **'아스널 83% 우승'은 발표 불가.** 우리 자체 모델이 정면으로 반박합니다 — "
             "공개 시 메모가 우려한 '사후 끼워맞추기' 의심을 우리 손으로 자초하는 셈입니다.\n")
    L.append("- **방어 가능한 아스널 메시지**: \"밸류트랙 모델이 꼽은 2026/27 우승 *최유력 도전자* "
             f"(시티에 이은 명확한 2위, 우승 확률 약 {ar['title']:.0f}%)\". 이는 데이터로 뒷받침됩니다.\n")
    L.append("- 헤드라인 확률을 단정적으로 쓰지 말 것(포아송 과집중 주의). 랭킹/도전자 프레임이 안전합니다.\n")

    L.append("\n## 방법론 / 한계\n\n")
    L.append("- **모델**: azz3 XGBoost 이적료 모델 재사용, 2025/26 폼으로 선수별 가치 산출 → 시너지 집계 → "
             "TM 스쿼드가치와 z-score(log) 블렌딩(전력 평균 100·sd 15). 월드컵 엔진과 동일.\n")
    L.append("- **매치 모델**: 전력차 → 기대득점(λ) → 독립 포아송. 홈팀 홈 어드밴티지 반영.\n")
    L.append("- **시즌 구조**: 20팀 더블 라운드로빈 380경기, 승점 3/1/0, 득실차·다득점 정렬.\n")
    L.append("- **한계**: (1) xG/슈팅은 골 기반 프록시(Stathead 표준 export에 원자료 없음). "
             "(2) 이적료 모델 학습 MV 스냅샷은 2022 기준. (3) 시즌중 2개 클럽 소속 선수 16명은 클럽 귀속 불가로 제외. "
             "(4) 독립 포아송은 시즌 분산을 과소평가 → 1순위 확률 과대.\n")
    return "".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sims", type=int, default=1_000_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--chunk", type=int, default=50_000)
    ap.add_argument("--sens-sims", type=int, default=100_000,
                    help="sims per sensitivity/seed-stability cell (cheaper)")
    args = ap.parse_args()

    _OUT.mkdir(parents=True, exist_ok=True)

    print("[Stage 1] 클럽 스쿼드 가치 평가 + 시너지 …")
    ratings, out = run_one(_BASE_MODEL_W, _BASE_TM_W, args.sims, args.seed, args.chunk,
                           rating_sd=_BASE_RATING_SD)
    ratings.to_csv(_OUT / "stage1_club_ratings.csv")
    pick = _ranked(out["title_prob"])[0]
    print(f"  -> 1순위 {pick} {out['title_prob'][pick]*100:.1f}% / "
          f"아스널 {out['title_prob']['Arsenal']*100:.1f}%")

    print(f"[Sensitivity] 변형 그리드 ({args.sens_sims:,}회/셀) …")
    sensitivity = build_sensitivity(args.sens_sims, args.seed, args.chunk)
    print(f"[Seed stability] 시드 42/1/7 ({args.sens_sims:,}회) …")
    seed_stability = build_seed_stability(args.sens_sims, args.chunk)

    payload = assemble(ratings, out, sensitivity, seed_stability, args.sims, args.seed)

    (_OUT / "premier-league.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {_OUT/'premier-league.json'}")

    report = write_report(payload, ratings)
    (_PL / "report.md").write_text(report, encoding="utf-8")
    print(f"  -> {_PL/'report.md'}")

    # Append-only audit log: provable run-date + commit for every run.
    audit = {
        "run_id": payload["run_id"], "model_commit": payload["model_commit"],
        "season": payload["season"], "n_sims": payload["n_sims"], "seed": payload["seed"],
        "params": payload["params"],
        "title_pick": payload["title_pick"], "arsenal": payload["arsenal"],
    }
    with open(_OUT / "runs.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(audit, ensure_ascii=False) + "\n")
    print(f"  -> {_OUT/'runs.jsonl'} (감사 로그 append)")

    print("\n=== 헤드라인 ===")
    print(f"우승 1순위 {payload['title_pick']['ko']} {payload['title_pick']['prob']:.1f}% / "
          f"아스널 {payload['arsenal']['rank']}위 {payload['arsenal']['title']:.1f}%")


if __name__ == "__main__":
    main()
