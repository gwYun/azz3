"""밸류트랙 — 2026 여름 이적시장 행선지·이적료 예측 (오케스트레이터).

기존 azz3 이적료 모델을 재사용해 핵심 선수들의 (1) 모델 추정 시장가치(이적료
범위)와 (2) 과거 영입 성향 기반 '가장 적합한 행선지'를 산출한다.

산출물:
  1) outputs/recommendations.csv   — (선수 × 후보 구단) 랭킹 + 이적료 범위
  2) outputs/recommendations.json  — 구조화 감사본
  3) report.md                     — 빈칸이 채워진 한국어 보도자료 fragment

실행:  python -m destination.scripts.run_recommender --top_k 5
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

_HERE = Path(__file__).resolve()
_DEST = _HERE.parents[1]
_PROJECT_ROOT = _HERE.parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from destination.src import club_profiles as cp  # noqa: E402
from destination.src import fee_bridge as fb  # noqa: E402
from destination.src import fx  # noqa: E402
from destination.src import recommender as rec  # noqa: E402
from src.data import _normalize_name, load_stathead_2526  # noqa: E402

_DATA = _DEST / "data"
_OUT = _DEST / "outputs"


def load_targets() -> list:
    with open(_DATA / "target_players_2026.json") as f:
        return json.load(f)["players"]


def _match_stat_row(name: str, stats: pd.DataFrame):
    """Find a player's 2025/26 Stathead row by exact then normalized name."""
    exact = stats[stats["Player"] == name]
    if len(exact):
        return exact.iloc[0]
    key = _normalize_name(pd.Series([name])).iloc[0]
    norm = stats[_normalize_name(stats["Player"]) == key]
    if len(norm):
        return norm.iloc[0]
    return None


def write_report(results: list, ko_names: dict, top_k: int) -> str:
    L = []
    L.append("# 밸류트랙 — 2026 여름 이적시장 핵심 선수 예측\n")
    L.append("> azz3 이적료 예측 모델로 추정한 **시장가치(이적료 범위)**와, 과거 빅5 영입 이력에서 "
             "도출한 **가장 적합한 행선지**입니다. 대상 선수 모두 현 소속 구단의 핵심 자원으로 "
             "실제 이적 가능성은 낮으며, 아래는 *‘만약 이적한다면’* 을 전제로 한 모델 추정입니다.\n")

    # 헤드라인 한 줄씩 (보도자료 템플릿)
    L.append("\n## 핵심 결론\n")
    bullets = []
    for r in results:
        ko = r["name_ko"]
        from_ko = ko_names.get(r["from_club"], r["from_club"])
        to_ko = ko_names.get(r["top1_club"], r["top1_club"])
        bullets.append(f"▲{ko} 선수는 {from_ko}에서 {to_ko}(으)로 이적, 이적료 {r['fee_range_usd']}")
    L.append("밸류트랙 시뮬레이션에 따르면 " + ", ".join(bullets) + "(으)로 예측됐다.\n")

    # 선수별 상세
    for r in results:
        L.append(f"\n## {r['name_ko']} ({r['name']})\n")
        L.append(f"- 현 소속: {ko_names.get(r['from_club'], r['from_club'])} · {r['nationality']} · {r['age']}세\n")
        L.append(f"- 모델 추정 이적료(포인트): **€{r['point_eur']/1e6:.0f}M** "
                 f"(범위 €{r['low_eur']/1e6:.0f}M~€{r['high_eur']/1e6:.0f}M)\n")
        L.append(f"- USD 환산: **{r['fee_range_usd']}**\n")
        L.append(f"- 2025/26 실적: {r['gls']:.0f}골 {r['ast']:.0f}도움\n")
        L.append(f"\n**가장 적합한 행선지 Top {top_k}** (과거 영입 성향 기반 적합도):\n\n")
        L.append("| 순위 | 구단 | 리그 | 적합도 | 이적료 범위(€M) |\n|---:|---|---|---:|---|\n")
        for row in r["topk"]:
            to_ko = ko_names.get(row["to_club"], row["to_club"])
            mark = " ★" if row["to_club"] == r["top1_club"] else ""
            L.append(f"| {row['rank']} | {to_ko}{mark} | {row['dest_league']} | {row['fit_score']:.3f} | "
                     f"{row['fee_low_eur']/1e6:.0f}~{row['fee_high_eur']/1e6:.0f} |\n")
        L.append("\n*★ = 헤드라인 행선지. 각 선수의 헤드라인은 서로 다른 구단으로 분산 배정했다"
                 "(적합도 1위가 겹치면 다음 순위 구단으로). 표의 적합도 순위는 분산 배정 전 원점수다.*\n")

    L.append("\n## 데이터 한계 / 방법론\n")
    L.append("- **이적료는 행선지 무관(destination-agnostic)**: 모델에 영입 구단 피처가 없어 "
             "동일 선수는 행선지와 관계없이 단일 포인트 이적료를 산출한다. 표기 **범위는 행선지 구단의 "
             "통상 지출대로 조형한 밴드**이며, 모델이 구단별로 이적료를 다르게 산출한 것이 아니다.\n")
    L.append("- **클럽 적합도 = 과거 영입 성향**(2014–2022 빅5 이적 이력, 포지션·국적·출신리그·연령·지출대, "
             "최근 시즌 가중). 내부 정보가 아니다.\n")
    L.append("- **2026 활동 후보 = 수기 큐레이션 화이트리스트**(`suitor_clubs_2026.json`).\n")
    L.append("- **선수 스탯 = 2025/26 실데이터**(Stathead 빅5 3,354명). 단 **xG·슈팅 지표는 실측이 아닌 "
             "득점 기반 프록시**(xG≈골, xAG≈도움 등 휴리스틱)라 공격수 이적료 추정 불확실성이 크다.\n")
    L.append("- **가격 시점·인플레이션**: 모델은 2014–2022 이적으로 학습하며, 입력 시장가치와 타깃 "
             "이적료를 모두 **2014년 통화가치로 디플레이트**해 동일 척도에서 학습한다. 예측 시에는 선수의 "
             "2026년 시장가치를 2014년 가치로 환산해 모델에 넣고, 산출된 2014년 가치 이적료를 다시 "
             "**2026년 가치로 환산**한다. 이때 2026년 인플레이션 계수(2014년 대비 약 4.8배)는 2014–2022 "
             "추세를 **로그선형 외삽**한 값으로, 외삽 구간이 길어 헤드라인 금액의 불확실성이 크다.\n")
    L.append("- **이적료가 행선지에 따라 달라지는 근거**: 모델에 **영입구단 프리미엄 × 선수가치 상호작용** "
             "피처를 추가했다(구단별 과거 fee/시장가치 비율, 학습셋 전용 추정). 빅클럽이 동일 선수에 더 많이 "
             "지불하는 효과를 반영하되, 구단의 총지출·영입 규모가 개별 이적료에 새는 것을 막기 위해 "
             "선수가치와의 상호작용으로만 들어간다(저가 선수에는 효과가 작음).\n")
    L.append(f"- **EUR→USD 환율 {fx.EUR_USD} 고정 가정**(2026년 6월 기준).\n")
    L.append("- **리그 사전확률 = 경험적 prior**(학습된 분류기 아님), 5개 빅리그 한정.\n")
    return "".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top_k", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)  # reserved for reproducibility parity
    ap.add_argument("--distinct", dest="distinct", action="store_true", default=True,
                    help="Assign each player a distinct headline club (default on).")
    ap.add_argument("--no-distinct", dest="distinct", action="store_false",
                    help="Allow players to share the same top-1 club (raw ranking).")
    args = ap.parse_args()

    _OUT.mkdir(parents=True, exist_ok=True)

    print("[1/3] 모델·프로필·데이터 로드 …")
    art = fb.load_model()
    prof_df = cp.build_profile_frame()
    profiles = cp.fit_profiles(prof_df, art.deflator)
    league_prior = rec.dest_league_prior(prof_df)
    shortlist, ko_names, prestige = rec.load_suitor_shortlist()
    stats = load_stathead_2526()
    targets = load_targets()

    # Shortlist coverage check (log unmatched club names).
    unmatched = [c for c in shortlist if c not in profiles]
    if unmatched:
        print(f"  ⚠ shortlist 구단이 프로필에 없음 (철자 확인): {unmatched}")

    print(f"[2/3] {len(targets)}명 추천 산출 (top_k={args.top_k}) …")
    # Compute each player's full ranking once (enough depth to diversify top-1).
    tables = {}
    for p in targets:
        stat_row = _match_stat_row(p["name"], stats)
        if stat_row is None:
            print(f"  ⚠ {p['name']} 가 Stathead 명단에 없음 → median-fill로 진행")
        tables[p["name"]] = (
            stat_row,
            rec.recommend(p, stat_row, profiles, league_prior, shortlist, art,
                          top_k=max(args.top_k, 6), prestige=prestige),
        )

    # Greedy distinct top-1: assign each player their highest-scoring club that
    # isn't already taken, so the headline destinations don't all collide on the
    # single most-prestigious club. The full per-player ranking is still reported.
    #
    # Order by PLAYER VALUE (most expensive first), NOT by fit_score. Ordering by
    # fit_score let the cheapest player — who "fits" every elite club's
    # affordability gate — claim the most prestigious club first, pushing marquee
    # players onto lesser clubs. Value-first means the biggest names get first pick
    # of the top clubs, which is both more intuitive and more defensible.
    headline_club = {}
    if args.distinct:
        order = sorted(targets, key=lambda p: float(p["prior_market_value_eur"]), reverse=True)
        taken = set()
        for p in order:
            tbl = tables[p["name"]][1]
            pick = next((c for c in tbl["to_club"] if c not in taken), tbl.iloc[0]["to_club"])
            headline_club[p["name"]] = pick
            taken.add(pick)

    csv_rows = []
    results = []
    for p in targets:
        stat_row, full_table = tables[p["name"]]
        hl = headline_club.get(p["name"], full_table.iloc[0]["to_club"])
        top1 = full_table[full_table["to_club"] == hl].iloc[0]
        table = full_table.head(args.top_k).reset_index(drop=True)
        low_usd = fx.eur_to_usd(top1["fee_low_eur"])
        high_usd = fx.eur_to_usd(top1["fee_high_eur"])
        results.append({
            "name": p["name"], "name_ko": p["name_ko"],
            "from_club": p["current_club"], "nationality": p["nationality"], "age": p["age"],
            "point_eur": float(top1["predicted_fee_eur"]),
            "low_eur": float(top1["fee_low_eur"]), "high_eur": float(top1["fee_high_eur"]),
            "top1_club": top1["to_club"],
            "fee_range_usd": fx.format_usd_man_range(low_usd, high_usd),
            "gls": float(stat_row["Gls"]) if stat_row is not None else 0.0,
            "ast": float(stat_row["Ast"]) if stat_row is not None else 0.0,
            "topk": table.to_dict("records"),
        })
        for _, row in table.iterrows():
            csv_rows.append({
                "player": p["name"], "from_club": p["current_club"],
                "rank": int(row["rank"]), "to_club": row["to_club"],
                "dest_league": row["dest_league"], "fit_score": row["fit_score"],
                "predicted_fee_eur": row["predicted_fee_eur"],
                "fee_low_eur": row["fee_low_eur"], "fee_high_eur": row["fee_high_eur"],
                "fee_usd_range": fx.format_usd_man_range(
                    fx.eur_to_usd(row["fee_low_eur"]), fx.eur_to_usd(row["fee_high_eur"])),
                "shortlisted": row["shortlisted"],
            })

    pd.DataFrame(csv_rows).to_csv(_OUT / "recommendations.csv", index=False)
    with open(_OUT / "recommendations.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=float)
    print(f"  -> {_OUT/'recommendations.csv'} ({len(csv_rows)} rows)")
    print(f"  -> {_OUT/'recommendations.json'}")

    print("[3/3] 한국어 리포트 작성 …")
    report = write_report(results, ko_names, args.top_k)
    (_DEST / "report.md").write_text(report, encoding="utf-8")
    print(f"  -> {_DEST/'report.md'}")

    print("\n=== 헤드라인 ===")
    for r in results:
        print(f"▲{r['name_ko']}: {r['from_club']} → {r['top1_club']} | {r['fee_range_usd']}")


if __name__ == "__main__":
    main()
