"""ValueTrack KBO v2 — bottom-up player-level prediction (orchestrator).

Builds every team from its real players (WAR value → roster/lineup → team rs/ra),
simulates the 144-game season + Korean Series stepladder, and writes kbo.json + a Korean
report. Unlike v1's team-total shortcut, the ratings come from players up; the engine is
validated by the 2015-2019 backtest (included in the output).

Data: full open rosters for the backtest (robots-clean LOPES dump); 2026-live from real
/Record regulars + a team-total-anchored bench residual. statiz is never scraped.

Run:  python -m kbo.scripts.run_bottomup --sims 500000
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from datetime import datetime, timezone

import pandas as pd

from kbo.src import config, data, player_value as pv, salary_model, team_build as tbuild
from kbo.src import live2026, backtest, postseason as post
from kbo.src.season_simulate import Season

_OUT = config.OUTPUTS_DIR
_WEB = config.PROJECT_ROOT / "web" / "public" / "kbo.json"
_SIM_PARAMS = dict(breadth=6.0, mode="actual", wexp_weight=0.04, tactics_weight=1.0, fip_blend=0.25)


def _git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       cwd=str(config.PROJECT_ROOT)).decode().strip()
    except Exception:
        return "unknown"


def _ranked(prob: dict) -> list[str]:
    return [t for t, _ in sorted(prob.items(), key=lambda x: -x[1])]


def _real_salary_lookup(season: int) -> dict:
    """(player, franchise) -> real disclosed salary in 억 for `season`, from the salary
    reference. DISPLAY ONLY — never fed into payroll (that would mix actual FA salary with
    WAR value and double-count star talent already in the ratings)."""
    ref = data.load_salary_reference()
    r = ref[(ref["season"] == season) & ref["is_disclosed"].astype(bool)]
    return {(str(p), str(f)): round(float(w) / 1e8, 1)
            for p, f, w in zip(r["player"], r["franchise"], r["salary_won"])}


def _payroll_validation(ratings: pd.DataFrame) -> dict:
    """Spearman ρ of the model's team payroll (sum of estimated salaries) vs. the real
    KBO 2026 per-club average salary — the least-censored check the reference allows."""
    real = data.load_team_salary_2026().set_index("franchise")["avg_salary_won"]
    df = pd.DataFrame({"model": ratings["payroll_ok"], "real": real}).dropna()
    rho = float(df["model"].corr(df["real"], method="spearman"))
    return {"n_teams": int(len(df)), "spearman_rho": round(rho, 3),
            "note": "모델 추정연봉 합(payroll) 순위 vs KBO 공식 2026 팀 평균연봉 순위"}


def build_and_sim(sims: int, seed: int, chunk: int):
    c, raw = live2026.build_2026_raw()
    values = {"batters": salary_model.add_salary(pv.batter_value(raw["batters"], c)),
              "pitchers": salary_model.add_salary(pv.pitcher_value(raw["pitchers"], c))}
    ratings = tbuild.build_team_ratings(2026, constants=c, values=values, **_SIM_PARAMS)
    rs, ra = ratings["rs_per_game"].to_dict(), ratings["ra_per_game"].to_dict()
    lg = c["lg_R_per_G"]
    pfn = lambda rng, seeds, srs, sra: post.simulate_postseason(rng, seeds, srs, sra, lg)
    out = Season(rs, ra, lg, seed=seed).run(sims, chunk=chunk, postseason_fn=pfn)
    return ratings, values, out


def leaderboard(values: dict, n: int = 20) -> list[dict]:
    real = _real_salary_lookup(config.CURRENT_SEASON)
    b = values["batters"]
    b = b[~b["name"].astype(str).str.startswith("(")].nlargest(n, "WAR")
    p = values["pitchers"]
    p = p[~p["name"].astype(str).str.startswith("(")].nlargest(n, "WAR")
    rows = []
    for _, r in b.iterrows():
        rows.append({"name": r["name"], "franchise_ko": data.TEAM_KO[r["franchise"]],
                     "kind": "bat", "war": round(float(r["WAR"]), 1),
                     "metric": round(float(r["wRC_plus"]), 0), "metric_label": "wRC+",
                     "salary_ok": round(float(r["est_salary_won"]) / 1e8, 1),
                     "real_salary_ok": real.get((str(r["name"]), str(r["franchise"])))})
    for _, r in p.iterrows():
        rows.append({"name": r["name"], "franchise_ko": data.TEAM_KO[r["franchise"]],
                     "kind": "pit", "war": round(float(r["WAR"]), 1),
                     "metric": round(float(r["FIP"]), 2), "metric_label": "FIP",
                     "salary_ok": round(float(r["est_salary_won"]) / 1e8, 1),
                     "real_salary_ok": real.get((str(r["name"]), str(r["franchise"])))})
    return sorted(rows, key=lambda x: -x["war"])[:n]


def assemble(ratings, values, out, bt: pd.DataFrame, sims, seed) -> dict:
    champ = out["champion_prob"]
    ranked = _ranked(champ)
    pick = ranked[0]
    teams = []
    for rank, code in enumerate(ranked, 1):
        row = ratings.loc[code]
        teams.append({
            "en": data.TEAM_EN[code], "ko": data.TEAM_KO[code], "rank": rank,
            "championship": round(champ[code] * 100, 2),
            "pennant": round(out["pennant_prob"][code] * 100, 1),
            "playoff": round(out["playoff_prob"][code] * 100, 1),
            "first": round(out["first_prob"][code] * 100, 1),
            "off_rating": round(float(row["off_rating"]), 1),
            "def_rating": round(float(row["def_rating"]), 1),
            "proj_wins": round(out["mean_wins"][code], 1),
            "rs_per_game": round(float(row["rs_per_game"]), 2),
            "ra_per_game": round(float(row["ra_per_game"]), 2),
            "payroll_ok": int(row["payroll_ok"]),
        })
    return {
        "version": "v2-bottomup", "season": "2026",
        "run_id": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_commit": _git_commit(), "n_sims": sims, "seed": seed,
        "method": "bottom-up player-level (WAR value → lineup/playing-time → team rs/ra; winning-env from WAR, salary display-only)",
        "params": _SIM_PARAMS,
        "title_pick": {"en": data.TEAM_EN[pick], "ko": data.TEAM_KO[pick],
                       "prob": round(champ[pick] * 100, 2)},
        "teams": teams,
        "players": leaderboard(values),
        "salary_diagnostics": salary_model.evaluate_against_reference(),
        "payroll_validation": _payroll_validation(ratings),
        "backtest": {
            "seasons": config.BACKTEST_SEASONS,
            "mean_standings_rho": round(float(bt["standings_rho"].mean()), 3),
            "champion_hit_rate": round(float(bt["pick_correct"].mean()), 2),
            "mean_prob_of_actual_champ": round(float(bt["champ_prob_of_actual"].mean()), 1),
            "rows": bt.to_dict(orient="records"),
        },
        "caveat": ("선수 단위 bottom-up 예측. 엔진은 2015-2019 전체 로스터로 백테스트 검증됨. "
                   "2026은 규정 선수(실데이터)+팀 합계 앵커 벤치로 구성(뎁스 근사). 독립 경기 "
                   "노이즈로 1순위 확률은 다소 과대. 연봉은 실연봉 중앙값에 레벨 보정한 WAR→₩ 추정"
                   "(기울기 미적합, 개별 예측 아님)이며 표시 전용."),
    }


def write_report(payload: dict) -> str:
    L = ["# 밸류트랙 KBO v2 — 선수 단위 bottom-up 우승 예측\n\n"]
    L.append(f"> 실행(UTC) `{payload['run_id']}` · 커밋 `{payload['model_commit']}` · "
             f"{payload['n_sims']:,}회 시뮬 (시드 {payload['seed']})\n\n")
    bt = payload["backtest"]
    L.append(f"**백테스트(2015-2019, 전체 로스터):** 순위 상관 ρ={bt['mean_standings_rho']}, "
             f"우승 적중 {bt['champion_hit_rate']*100:.0f}%, 실제 우승팀 평균 부여확률 "
             f"{bt['mean_prob_of_actual_champ']}% (무작위 10%).\n\n")
    p = payload["title_pick"]
    L.append(f"## 2026 우승 1순위: {p['ko']} — {p['prob']:.1f}%\n\n")
    L.append("| 순위 | 구단 | 우승 | 한국시리즈 | 가을야구 | 정규1위 | 공격 | 수비 | 예상승 | 추정연봉(억) |\n")
    L.append("|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|\n")
    for t in payload["teams"]:
        L.append(f"| {t['rank']} | {t['ko']} | {t['championship']:.1f}% | {t['pennant']:.0f}% | "
                 f"{t['playoff']:.0f}% | {t['first']:.0f}% | {t['off_rating']:.0f} | "
                 f"{t['def_rating']:.0f} | {t['proj_wins']:.1f} | {t['payroll_ok']} |\n")
    L.append("\n## 선수 가치 리더보드 (WAR / 추정연봉)\n\n| 선수 | 팀 | WAR | 지표 | 추정연봉(억) | 실연봉(억) |\n|---|---|---:|---:|---:|---:|\n")
    for pl in payload["players"][:15]:
        real = pl.get("real_salary_ok")
        L.append(f"| {pl['name']} | {pl['franchise_ko']} | {pl['war']} | "
                 f"{pl['metric_label']} {pl['metric']} | {pl['salary_ok']} | "
                 f"{real if real is not None else '-'} |\n")
    d = payload.get("salary_diagnostics", {})
    pv_ = payload.get("payroll_validation", {})
    if d.get("n"):
        L.append("\n## 연봉 모델 검증 (실연봉 레퍼런스 대비)\n\n")
        L.append(f"WAR→₩ 곡선을 실제 상위 연봉자 {d['n']}명(공개 스탯티즈, 실현 WAR>0)과 비교. "
                 f"SCALE을 실연봉 중앙값에 맞춰 **레벨 보정**했으므로 median(실/추정)="
                 f"**{d['median_real_over_est']}**(≈1)로 크기는 일치합니다. 다만 레퍼런스는 상위 연봉자만 담긴 "
                 f"**절단 표본**(≥₩13.65억)이라 WAR↔연봉 상관이 **{d['corr_war_salary']}**(≈0)이고 "
                 f"R²(level)={d['r2_level']} — **개별** 연봉은 WAR로 예측 불가(레벨만 보정, 기울기 미적합). "
                 f"팀 payroll 순위 vs KBO 공식 2026 팀 평균연봉 순위 Spearman ρ="
                 f"**{pv_.get('spearman_rho')}**(팀 {pv_.get('n_teams')}개).\n")
    L.append(f"\n## 방법론\n\n- **데이터**: 백테스트=공개 전체 로스터(LOPES, 2010-2020, 박스스코어 디코딩), "
             "2026=KBO /Record 규정선수+팀합계 앵커 벤치. statiz는 스크레이핑하지 않음(robots 차단); "
             "실연봉 레퍼런스(정적 파일)는 검증에만 사용.\n")
    L.append("- **파이프라인**: 선수 스탯 → 가치(wOBA/wRC+/FIP/WAR) → 라인업·출전 preset·감독 전술 → "
             "팀 공격/수비 득점 → 승리환경(**WAR**+시너지) → 144경기+한국시리즈 몬테카를로 "
             "(추정연봉은 표시용, 시뮬 미투입).\n")
    L.append(f"- **한계**: {payload['caveat']}\n")
    return "".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sims", type=int, default=500_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--chunk", type=int, default=25_000)
    ap.add_argument("--bt-sims", type=int, default=20_000)
    ap.add_argument("--no-web-copy", action="store_true")
    args = ap.parse_args()

    _OUT.mkdir(parents=True, exist_ok=True)
    print(f"[backtest] 2015-2019 검증 ({args.bt_sims:,}회/시즌) …")
    bt = backtest.evaluate(sims=args.bt_sims, **_SIM_PARAMS)
    print(f"  ρ={bt['standings_rho'].mean():.3f} 우승적중={bt['pick_correct'].mean()*100:.0f}%")
    print(f"[2026] bottom-up 전력 + {args.sims:,}회 시뮬 …")
    ratings, values, out = build_and_sim(args.sims, args.seed, args.chunk)
    payload = assemble(ratings, values, out, bt, args.sims, args.seed)

    (_OUT / "kbo.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (config.KBO_DIR / "report.md").write_text(write_report(payload), encoding="utf-8")
    if not args.no_web_copy:
        _WEB.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_OUT / "kbo.json", _WEB)
    print(f"  -> {_OUT/'kbo.json'} · report.md · web copy")
    print(f"\n=== 2026 우승 1순위 {payload['title_pick']['ko']} {payload['title_pick']['prob']:.1f}% ===")


if __name__ == "__main__":
    main()
