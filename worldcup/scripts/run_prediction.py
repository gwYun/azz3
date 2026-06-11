"""밸류트랙 — 2026 월드컵 우승 예측 파이프라인 (오케스트레이터).

Stage 1 (가치 평가/랭킹) -> Stage 2 (백만 회 PvP 시뮬레이션) -> 3개 산출물 + 한국어 리포트.

산출물:
  1) outputs/stage1_rankings.csv     — 가치 기반 팀 전력 랭킹
  2) outputs/sim_distribution.json   — 나라별 우승확률 / 4강확률 / 최빈 4강 시나리오
  3) report.md                       — 빈칸이 채워진 밸류트랙 헤드라인 + 표 + 방법론

실행:  python -m worldcup.scripts.run_prediction --sims 1000000
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from worldcup.src import squad_strength as ss
from worldcup.src import simulate as sim

_WC = Path(__file__).resolve().parents[1]
_OUT = _WC / "outputs"

# 영문 팀명 -> 한국어 표기
_KO = {
    "France": "프랑스", "England": "잉글랜드", "Spain": "스페인", "Portugal": "포르투갈",
    "Germany": "독일", "Brazil": "브라질", "Argentina": "아르헨티나", "Netherlands": "네덜란드",
    "Norway": "노르웨이", "Belgium": "벨기에", "Ivory Coast": "코트디부아르", "Morocco": "모로코",
    "Senegal": "세네갈", "Turkiye": "튀르키예", "Sweden": "스웨덴", "Uruguay": "우루과이",
    "Croatia": "크로아티아", "United States": "미국", "Ecuador": "에콰도르", "Switzerland": "스위스",
    "Colombia": "콜롬비아", "Japan": "일본", "Austria": "오스트리아", "Algeria": "알제리",
    "Ghana": "가나", "Canada": "캐나다", "Mexico": "멕시코", "Czechia": "체코",
    "Scotland": "스코틀랜드", "Paraguay": "파라과이", "Bosnia-Herzegovina": "보스니아",
    "Congo DR": "콩고민주공화국", "South Korea": "대한민국", "Egypt": "이집트", "Australia": "호주",
    "Uzbekistan": "우즈베키스탄", "Tunisia": "튀니지", "Cape Verde": "카보베르데", "Haiti": "아이티",
    "South Africa": "남아프리카공화국", "Saudi Arabia": "사우디아라비아", "New Zealand": "뉴질랜드",
    "Panama": "파나마", "Iran": "이란", "Curacao": "퀴라소", "Iraq": "이라크",
    "Qatar": "카타르", "Jordan": "요르단",
}


def ko(team: str) -> str:
    return _KO.get(team, team)


def compute_outputs(res: dict, teams: list[str]) -> dict:
    """3개 산출물 계산."""
    champ = pd.Series(res["champion"])
    n = len(champ)
    sf = res["semifinalists"]  # [n,4] object array

    # Output 1: 나라별 우승 확률 (합 100%)
    win_counts = champ.value_counts()
    win_prob = (win_counts / n).reindex(teams).fillna(0.0)
    win_prob = win_prob / win_prob.sum()  # 정규화 -> 합 1.0

    # 4강 진출 확률 (교차검증용)
    sf_flat = pd.Series(sf.ravel())
    sf_prob = (sf_flat.value_counts() / n).reindex(teams).fillna(0.0)

    # Output 2 & 3: 최빈 4강 시나리오 (정확히 같은 4개국 집합)
    sets = [frozenset(sf[i]) for i in range(n)]
    set_counts = Counter(sets)
    top_set, top_count = set_counts.most_common(1)[0]
    top_set_prob = top_count / n

    # 그 4개국을 우승확률 순으로 1~4위 정렬
    members = sorted(top_set, key=lambda t: win_prob.get(t, 0.0), reverse=True)

    return {
        "n_sims": int(n),
        "win_prob": win_prob,
        "sf_prob": sf_prob,
        "top4_set": members,            # 1위->4위
        "top4_set_prob": float(top_set_prob),
        "second_set": [sorted(s, key=lambda t: win_prob.get(t, 0.0), reverse=True)
                       for s, _ in set_counts.most_common(3)],
        "second_set_prob": [c / n for _, c in set_counts.most_common(3)],
    }


def write_report(stage1: pd.DataFrame, out: dict, sims: int, seed: int) -> str:
    wp = out["win_prob"].sort_values(ascending=False)
    sfp = out["sf_prob"]
    top4 = out["top4_set"]
    t1, t2, t3, t4 = (ko(t) for t in top4)

    L = []
    L.append("# 밸류트랙 — 2026 FIFA 월드컵 우승 예측 리포트\n")
    L.append("> 선수 이적료 예측 모델(밸류트랙)로 각국 선수 가치를 평가하고, ")
    L.append("그 전력으로 실제 2026 대진표를 ")
    L.append(f"**{sims:,}회** 시뮬레이션한 결과입니다.\n")

    L.append("\n## 핵심 결론\n")
    L.append(f"**밸류트랙이 분석한 이번 월드컵의 강력한 우승 후보 1위는 [{t1}]이다. "
             f"이어 2위 [{t2}], 3위 [{t3}], 4위 [{t4}] 순으로 4강 구도를 형성할 것으로 전망됐다.**\n")
    champ_team = top4[0]
    L.append(f"\n- 최종 우승 확률 1위: **{ko(champ_team)} {wp.get(champ_team, 0)*100:.1f}%**\n")
    L.append(f"- 위 4개국 각각의 4강 진출 확률: "
             + ", ".join(f"{ko(t)} {sfp.get(t,0)*100:.0f}%" for t in top4) + "\n")
    L.append(f"- 이 **정확히 같은 4개국**이 동시에 4강에 오를 확률(최빈 시나리오): "
             f"**{out['top4_set_prob']*100:.2f}%** "
             f"(4강 조합의 경우의 수가 매우 많아 절대값은 작지만, 모든 조합 중 최빈값)\n")

    L.append("\n## 1) 나라별 우승 확률 (전체 48개국, 합계 100%)\n")
    L.append("| 순위 | 국가 | 우승 확률 | 4강 진출 확률 |\n|---:|---|---:|---:|\n")
    for i, (team, p) in enumerate(wp.items(), 1):
        L.append(f"| {i} | {ko(team)} | {p*100:.2f}% | {sfp.get(team,0)*100:.1f}% |\n")

    # 4강 진출 확률 상위 4개국 (강건한 4강 구도)
    sf_top4 = list(sfp.sort_values(ascending=False).head(4).index)
    agree = set(sf_top4) == set(top4)

    L.append("\n## 2) 가장 유력한 4강 시나리오\n")
    L.append(f"백만 회 시뮬레이션에서 **가장 자주 등장한 정확한 4강 조합**은 "
             f"**{', '.join(ko(t) for t in top4)}** 이다.\n")
    L.append(f"\n- 이 **정확히 같은 4개국** 조합이 나올 확률: **{out['top4_set_prob']*100:.2f}%** "
             f"(4강 경우의 수가 매우 많아 단일 조합 확률 자체는 낮음 — 그럼에도 이 조합이 최빈값).\n")
    L.append(f"- 교차검증: '4강 진출 확률' 상위 4개국 또한 "
             f"**{', '.join(ko(t) for t in sf_top4)}** 으로 "
             f"{'동일한 결과' if agree else '유사한 결과'}.\n")
    L.append("\n순위 내 정렬은 각국의 우승 확률 기준이다:\n\n")
    L.append("| 순위 | 국가 | 우승 확률 |\n|---:|---|---:|\n")
    for i, t in enumerate(top4, 1):
        L.append(f"| {i}위 | {ko(t)} | {wp.get(t,0)*100:.1f}% |\n")
    L.append("\n*참고 — 그 다음으로 유력한 4강 조합들:*\n")
    for s, p in zip(out["second_set"][1:], out["second_set_prob"][1:]):
        L.append(f"- {', '.join(ko(t) for t in s)} ({p*100:.1f}%)\n")

    L.append("\n## 3) Stage 1 — 가치 기반 팀 전력 랭킹 (상위 16개국)\n")
    L.append("선수 가치 평가 + 선수 조합 시너지(스쿼드 스파인 완성도·포지션 균형·클럽 케미스트리)를 "
             "반영한 전력 점수다.\n\n")
    L.append("| 순위 | 국가 | 전력점수 | TM 스쿼드가치(€M) | 시너지배수 |\n|---:|---|---:|---:|---:|\n")
    for i, (team, row) in enumerate(stage1.head(16).iterrows(), 1):
        L.append(f"| {i} | {ko(team)} | {row['rating']:.1f} | "
                 f"{row['tm_value_m']:.0f} | {row['synergy_mult']:.2f} |\n")

    L.append("\n## 왜 이렇게 예측했나\n")
    for t in top4:
        row = stage1.loc[t]
        L.append(f"- **{ko(t)}**: 전력점수 {row['rating']:.1f} "
                 f"(TM 스쿼드가치 €{row['tm_value_m']:.0f}M, 시너지배수 {row['synergy_mult']:.2f}, "
                 f"유럽파 코어 {int(row['n_core_euro'])}명). ")
        if row["spine"] >= 1.0:
            L.append("포지션별 핵심 선수가 고르게 분포된 균형 잡힌 스쿼드.\n")
        else:
            L.append("일부 포지션 편중이 있으나 상위 가치 선수층이 두텁다.\n")

    L.append("\n## 데이터 한계 / 방법론\n")
    L.append("- **모델**: azz3의 XGBoost 이적료 예측 모델을 재사용해 각 선수 가치를 산출.\n")
    L.append("- **커버리지**: 모델 학습 데이터는 유럽 빅5 리그 기반이라 비유럽 리그 선수는 직접 평가 불가. "
             "이를 보정하기 위해 각국 **트랜스퍼마르크트(Transfermarkt) 전체 스쿼드 가치**를 앵커로 혼합. "
             "(브라질·아르헨티나 등 비유럽 스쿼드 저평가 방지)\n")
    L.append("- **PvP 드라이버**: 순수 가치 전력만 사용(Elo·배당 미혼합). 개최국(미국·멕시코·캐나다) 홈 어드밴티지 반영.\n")
    L.append("- **매치 모델**: 전력차 → 기대득점(λ) → 독립 포아송 득점. 토너먼트 무승부는 승부차기(강팀 소폭 우세)로 처리.\n")
    L.append(f"- **시뮬레이션**: 실제 2026 대진표 기준 {sims:,}회 몬테카를로. 난수 시드 {seed} (재현 가능).\n")
    L.append("- **선수 가치 스냅샷**: 빅5 선수 가치 데이터는 2022 시즌 기준(가용 최신).\n")
    return "".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sims", type=int, default=1_000_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--chunk", type=int, default=50_000)
    args = ap.parse_args()

    _OUT.mkdir(parents=True, exist_ok=True)

    print(f"[Stage 1] 선수 가치 평가 + 시너지 집계 …")
    stage1 = ss.build_team_ratings()
    stage1.to_csv(_OUT / "stage1_rankings.csv")
    print(f"  -> {_OUT/'stage1_rankings.csv'} (상위: {', '.join(stage1.head(4).index)})")

    print(f"[Stage 2] {args.sims:,}회 시뮬레이션 …")
    ratings = stage1["rating"].to_dict()
    teams = list(stage1.index)
    tourney = sim.Tournament(ratings, seed=args.seed)
    res = tourney.run(args.sims, chunk=args.chunk)

    out = compute_outputs(res, teams)

    # sim_distribution.json
    dist = {
        "n_sims": out["n_sims"],
        "seed": args.seed,
        "nation_win_probability": {t: float(out["win_prob"][t]) for t in teams},
        "reach_sf_probability": {t: float(out["sf_prob"][t]) for t in teams},
        "most_probable_top4": out["top4_set"],          # 1->4
        "most_probable_top4_probability": out["top4_set_prob"],
        "runner_up_top4_sets": [
            {"teams": s, "prob": p}
            for s, p in zip(out["second_set"], out["second_set_prob"])
        ],
    }
    with open(_OUT / "sim_distribution.json", "w") as f:
        json.dump(dist, f, ensure_ascii=False, indent=2)
    print(f"  -> {_OUT/'sim_distribution.json'}")

    report = write_report(stage1, out, args.sims, args.seed)
    (_WC / "report.md").write_text(report, encoding="utf-8")
    print(f"  -> {_WC/'report.md'}")

    t1, t2, t3, t4 = out["top4_set"]
    print("\n=== 헤드라인 ===")
    print(f"1위 {ko(t1)} / 2위 {ko(t2)} / 3위 {ko(t3)} / 4위 {ko(t4)} "
          f"(이 4강 시나리오 확률 {out['top4_set_prob']*100:.1f}%)")


if __name__ == "__main__":
    main()
