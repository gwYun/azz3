"""밸류트랙 — 2026 월드컵 스타 예측 (오케스트레이터).

월드컵에서 가치가 가장 많이 뛴 선수(브레이크아웃)를 골라, 예상 이적료와 가장 적합한
행선지를 산출하고, '가장 유력한 하메스 케이스'를 한 명 지목한다. 하메스 로드리게스가
2014 월드컵 뒤 모나코 → 레알 마드리드로 간 것과 같은 케이스를 찾는 것이 목표다.

파이프라인 (전부 기존 모듈 재사용):
  1) worldcup.squad_strength_v2 : 월드컵 참가국의 빅5 선수 풀 + 2025/26 폼 기반 모델가치
  2) wcstars.tournament_data     : 실제 대회 노출도 E + 개인 활약 P (FotMob/결과/이적뉴스)
  3) wcstars.breakout            : 브레이크아웃 배수 M, V0->V1 가치 점프, 랭킹, 하메스 픽
  4) destination.recommender     : 상위 선수의 구단별 이적료 + 가장 적합한 행선지

산출물: outputs/breakout_rankings.csv, outputs/breakout_stars.json, report.md,
        web/public/worldcup-stars.json

실행:  .venv/bin/python -m wcstars.scripts.run_stars --top 16
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

_HERE = Path(__file__).resolve()
_WCS = _HERE.parents[1]
_PROJECT_ROOT = _HERE.parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from destination.src import club_profiles as cp  # noqa: E402
from destination.src import fee_bridge as fb  # noqa: E402
from destination.src import fx  # noqa: E402
from destination.src import recommender as rec  # noqa: E402
from worldcup.src import squad_strength_v2 as ssv2  # noqa: E402
from wcstars.src import breakout as bo  # noqa: E402
from wcstars.src import calibration as cal  # noqa: E402
from wcstars.src import tournament_data as td  # noqa: E402

_OUT = _WCS / "outputs"
_WEB_JSON = _PROJECT_ROOT / "web" / "public" / "worldcup-stars.json"

_LEAGUE_MAP = {"Premier League": "Premier League", "La Liga": "LaLiga", "LaLiga": "LaLiga",
               "Serie A": "Serie A", "Bundesliga": "Bundesliga", "Ligue 1": "Ligue 1"}
_POS_MAP = {"FW": "forward", "MF": "midfielder", "DF": "defender", "GK": "goalkeeper"}
_SUPERCLUB_PRESTIGE = 0.90  # a 하메스-style destination (Real Madrid, City, Bayern, PSG, Barça)

# Korean display names for the players likely to surface (fallback = Latin name).
_KO_PLAYER = {
    "Kylian Mbappé": "킬리안 음바페", "Lionel Messi": "리오넬 메시", "Jude Bellingham": "주드 벨링엄",
    "Johan Manzambi": "요한 만잠비", "Ayyoub Bouaddi": "아이유브 부아디", "Manu Koné": "마누 코네",
    "Michael Olise": "미카엘 올리세", "Ousmane Dembélé": "우스만 뎀벨레", "Pau Cubarsí": "파우 쿠바르시",
    "Rodri": "로드리", "Erling Haaland": "엘링 홀란", "Jamal Musiala": "자말 무시알라",
    "Rafael Leão": "하파엘 레앙", "Lamine Yamal": "라민 야말", "Pedri": "페드리", "Gavi": "가비",
    "Unai Simón": "우나이 시몬", "Nico Williams": "니코 윌리엄스", "Eduardo Camavinga": "에두아르도 카마빙가",
    "Ansu Fati": "안수 파티", "Nicolás Paz": "니코 파스", "Nilson Angulo": "닐손 앙굴로",
}
_KO_NATION = {
    "France": "프랑스", "Spain": "스페인", "Argentina": "아르헨티나", "England": "잉글랜드",
    "Switzerland": "스위스", "Morocco": "모로코", "Norway": "노르웨이", "Germany": "독일",
    "Portugal": "포르투갈", "Brazil": "브라질", "Ecuador": "에콰도르", "Netherlands": "네덜란드",
    "Belgium": "벨기에", "Paraguay": "파라과이", "Uruguay": "우루과이",
}


def _league_of(comp: str):
    comp = str(comp)
    return next((v for k, v in _LEAGUE_MAP.items() if k in comp), None)


def _player_dict(row, market_value_eur: float) -> dict:
    return {
        "name": row["Player"], "current_club": str(row["club"]),
        "current_league": _league_of(row.get("Comp")), "nationality": str(row["team"]),
        "age": float(row["age_years"]), "position_group": _POS_MAP.get(row["pos_bucket"], "midfielder"),
        "prior_market_value_eur": float(market_value_eur), "contract_years_remaining": 3,
    }


def _ko_player(name: str) -> str:
    return _KO_PLAYER.get(name, name)


def build_results(top: int, top_k: int) -> dict:
    art = fb.load_model()
    prof_df = cp.build_profile_frame()
    profiles = cp.fit_profiles(prof_df, art.deflator)
    league_prior = rec.dest_league_prior(prof_df)
    shortlist, ko_clubs, prestige = rec.load_suitor_shortlist()
    ko_clubs.setdefault("Borussia Dortmund", "보루시아 도르트문트")  # suitor file ko key is abbreviated

    pool = td.attach_signals(ssv2.load_player_pool_2526())
    board = bo.compute_board(pool, art)
    # A breakout board = players whose value actually moved. Drop zero-jump filler
    # (M≈1.0: no individual WC spotlight) so the tail isn't padded with non-breakouts.
    board = board[board["M"] > 1.02].reset_index(drop=True)
    head = board.head(top).copy()

    # Per-player destination ranking on the BOOSTED profile (V1 market value), plus a
    # neutral pre-WC fee (at V0) for the 이적료 점프 story.
    tables, neutral_pre = {}, {}
    for _, r in head.iterrows():
        pv1 = _player_dict(r, r["V1"])
        # Full-shortlist depth so the greedy distinct-headline pass always has an
        # untaken club to fall back to (18 clubs > 16 players); display still head(top_k).
        tables[r["Player"]] = rec.recommend(pv1, r, profiles, league_prior, shortlist, art,
                                            top_k=len(shortlist), prestige=prestige)
        pv0 = _player_dict(r, r["V0"])
        X0 = fb.player_to_model_row(pv0, r, art=art, dest_club=None)
        neutral_pre[r["Player"]] = float(fb.predict_fee_eur(art, X0)[0])

    # Greedy distinct headline club, in BREAKOUT order (this feature is about the
    # risers): the biggest breakout picks its best-fit club first, so a young mover
    # lands the super-club (the James -> Real Madrid story) while already-maxed stars,
    # who barely move anyway, take what's left.
    taken, headline = set(), {}
    for _, r in head.iterrows():
        tbl = tables[r["Player"]]
        pick = next((c for c in tbl["to_club"] if c not in taken), tbl.iloc[0]["to_club"])
        headline[r["Player"]] = pick
        taken.add(pick)

    # Assemble per-player records.
    recs = []
    for rank, (_, r) in enumerate(head.iterrows(), 1):
        full = tables[r["Player"]]
        hl = headline[r["Player"]]
        hrow = full[full["to_club"] == hl].iloc[0]
        dests = []
        for _, d in full.head(top_k).iterrows():
            dests.append({
                "rank": int(d["rank"]), "club": d["to_club"],
                "club_ko": ko_clubs.get(d["to_club"], d["to_club"]),
                "league": d["dest_league"], "fit": round(float(d["fit_score"]), 3),
                "fee_eur": float(d["predicted_fee_eur"]),
                "fee_low_eur": float(d["fee_low_eur"]), "fee_high_eur": float(d["fee_high_eur"]),
            })
        recs.append({
            "rank": rank, "name": r["Player"], "name_ko": _ko_player(r["Player"]),
            "nation": r["team"], "nation_ko": _KO_NATION.get(r["team"], r["team"]),
            "position": r["pos_bucket"], "age": int(round(r["age_years"])),
            "current_club": str(r["club"]),
            "v0_eur": float(r["V0"]), "v1_eur": float(r["V1"]), "multiplier": round(float(r["M"]), 2),
            "v0_source": r["v0_source"], "jump_eur": float(r["jump_eur"]),
            "wc_goals": int(r["wc_goals"]), "wc_assists": int(r["wc_assists"]),
            "wc_rating": round(float(r["wc_rating"]), 2), "P": round(float(r["P"]), 2),
            "E": round(float(r["E"]), 2), "nation_stage_weight": round(float(r["E"]), 2),
            "mover_status": (None if pd.isna(r.get("mover_status")) else r.get("mover_status")),
            "headline_club": hl, "headline_club_ko": ko_clubs.get(hl, hl),
            "headline_prestige": float(prestige.get(hl, 0.6)),
            "fee_eur": float(hrow["predicted_fee_eur"]),
            "fee_low_eur": float(hrow["fee_low_eur"]), "fee_high_eur": float(hrow["fee_high_eur"]),
            "fee_usd_range": fx.format_usd_man_range(fx.eur_to_usd(hrow["fee_low_eur"]),
                                                     fx.eur_to_usd(hrow["fee_high_eur"])),
            "neutral_fee_pre_eur": neutral_pre[r["Player"]],
            "destinations": dests,
        })

    # 하메스 픽: young attacker/creator, best archetype score, weighted toward a
    # super-club headline destination (James went to Real Madrid, not a mid club).
    def _james_weight(rec_):
        base = bo.james_score(head[head["Player"] == rec_["name"]].iloc[0])
        prestige_boost = 0.7 + 0.3 * min(rec_["headline_prestige"] / _SUPERCLUB_PRESTIGE, 1.0)
        return base * prestige_boost
    james = max(recs, key=_james_weight)

    results = td.load_results()
    return {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tournament": {
            "champion": results["final"]["winner"], "runner_up": results["final"]["runner_up"],
            "third": results["third_place"]["winner"], "awards": results["awards"],
        },
        "james_pick": {"name": james["name"], "name_ko": james["name_ko"], "rank": james["rank"]},
        "board": recs,
        "validation": cal.summary(board),
        "params": {"K": bo.K, "AMP_E": bo.AMP_E, "M_MAX": bo.M_MAX,
                   "ceiling_eur": bo.CEILING_EUR, "top": top, "top_k": top_k},
    }


# --------------------------------------------------------------------------- #
# Korean report (mirrors destination/scripts/run_recommender.write_report style)
# --------------------------------------------------------------------------- #
def write_report(data: dict) -> str:
    t = data["tournament"]; L = []
    L.append("# 밸류트랙 — 2026 월드컵 스타 예측 (브레이크아웃 · 이적료 · 행선지)\n")
    L.append(f"> 2026 월드컵(우승 **{t['champion']}**, 준우승 {t['runner_up']}, 3위 {t['third']}) 이후, "
             "대회에서 **가치가 가장 많이 뛴 선수**를 골라 예상 이적료와 가장 적합한 행선지를 추정했다. "
             "하메스 로드리게스가 2014 월드컵 득점왕 뒤 레알 마드리드로 간 것과 같은 케이스를 찾는다.\n")

    jp = data["james_pick"]
    top = data["board"][0]
    L.append("\n## 핵심 결론\n")
    L.append(f"- **가장 유력한 하메스 케이스: {jp['name_ko']} ({jp['name']})** — "
             f"보드 {jp['rank']}위, 젊은 브레이크아웃이 빅클럽행 프로필에 가장 근접.\n")
    L.append(f"- **가치 점프 1위: {top['name_ko']} ({top['name']})** — "
             f"€{top['v0_eur']/1e6:.0f}M → €{top['v1_eur']/1e6:.0f}M (×{top['multiplier']}), "
             f"예상 행선지 {top['headline_club_ko']}.\n")
    L.append("- 이미 정점에 있는 슈퍼스타(음바페 등)는 주목도는 최고지만 *가치 점프*는 작다(가치 천장). "
             "브레이크아웃은 **젊고 저평가된 개인 활약**에서 나온다.\n")

    L.append("\n## 브레이크아웃 보드 (가치 급등 순)\n")
    L.append("| 순위 | 선수 | 국가 | Pos | 나이 | 이적 전 | 이적 후 | 배수 | 예상 행선지 | 예상 이적료 |\n")
    L.append("|---:|---|---|:--:|---:|---:|---:|---:|---|---|\n")
    for r in data["board"]:
        star = " ★" if r["name"] == jp["name"] else ""
        L.append(f"| {r['rank']} | {r['name_ko']}{star} | {r['nation_ko']} | {r['position']} | {r['age']} | "
                 f"€{r['v0_eur']/1e6:.0f}M | €{r['v1_eur']/1e6:.0f}M | ×{r['multiplier']} | "
                 f"{r['headline_club_ko']} | €{r['fee_low_eur']/1e6:.0f}~{r['fee_high_eur']/1e6:.0f}M |\n")
    L.append("\n*★ = 하메스 픽. '이적 전/후'는 시장가치, '예상 이적료'는 행선지 구단의 영입 프리미엄이 반영된 값이다.*\n")

    # 상위 5명 상세 + 행선지 Top
    L.append("\n## 상위 브레이크아웃 상세\n")
    for r in data["board"][:5]:
        tag = {"confirmed": " · **실제 이적 확정**", "rumored": " · 실제 이적설"}.get(r["mover_status"], "")
        L.append(f"\n### {r['rank']}. {r['name_ko']} ({r['name']}){tag}\n")
        L.append(f"- {r['nation_ko']} · {r['current_club']} · {r['age']}세 · {r['position']}\n")
        if r["wc_goals"] or r["wc_assists"]:
            wc = f"{r['wc_goals']}골 {r['wc_assists']}도움" + (f" · 평점 {r['wc_rating']}" if r["wc_rating"] else "")
        else:
            wc = "FotMob 리더보드·이적 뉴스로 확인된 브레이크아웃"
        L.append(f"- 대회 활약: {wc} (개인활약 P={r['P']}, 국가 노출도 E={r['E']})\n")
        L.append(f"- 가치: €{r['v0_eur']/1e6:.0f}M → **€{r['v1_eur']/1e6:.0f}M** (×{r['multiplier']})\n")
        L.append(f"- 예상 이적료(행선지 {r['headline_club_ko']}): **€{r['fee_low_eur']/1e6:.0f}~{r['fee_high_eur']/1e6:.0f}M** "
                 f"({r['fee_usd_range']})\n")
        L.append("\n  가장 적합한 행선지: " +
                 ", ".join(f"{d['club_ko']}(€{d['fee_low_eur']/1e6:.0f}~{d['fee_high_eur']/1e6:.0f}M)"
                           for d in r["destinations"][:3]) + "\n")

    # 검증
    v = data["validation"]
    L.append("\n## 검증 — 실제 2026 이적과 대조\n")
    L.append(f"- 하메스 2014 앵커: 모델 배수 **×{v['james']['model_mult']}** vs 실제 ×{v['james']['target_mult']} "
             f"(오차 {v['james']['abs_err']}). 배수 스케일 K는 이 한 케이스에만 맞췄다.\n")
    L.append("- 아래는 **보정에 쓰지 않은** 실제 2026 이적/이적설로 크기만 대조한 것이다(모델 정직성 점검):\n\n")
    L.append("| 선수 | 상태 | 모델 예상가치 | 실제(이적료/호가) | 예상/실제 |\n|---|---|---:|---:|---:|\n")
    for m in v["movers"]:
        pv = f"€{m['pred_V1_eur']/1e6:.0f}M" if m['pred_V1_eur'] else "—"
        rv = f"€{m['real_eur']/1e6:.0f}M" if m['real_eur'] else "—"
        ratio = m['ratio_pred_over_real'] if m['ratio_pred_over_real'] else "—"
        L.append(f"| {m['name']} | {m['status']} | {pv} | {rv} | {ratio} |\n")
    L.append(f"\n중위 예상/실제 비율 ≈ **{v['median_pred_over_real']}**. {v['note']}\n")

    L.append("\n## 방법론 / 한계\n")
    L.append("- **브레이크아웃 배수**: `M = 1 + K·spotlight·youth·ceiling`. spotlight = P·(1+0.5·E)로 "
             "**개인 활약 P가 주동인**, 국가의 토너먼트 진출 깊이 E는 증폭만 한다(우승국의 무명 벤치 선수가 "
             "저절로 뜨지 않도록). 젊을수록(youth), 이미 고평가가 아닐수록(ceiling) 같은 활약이 더 큰 % 점프로 "
             "전환된다. **K(레벨)만** 하메스 2014에 맞췄고 기울기는 맞추지 않았다(kbo 연봉모델과 동일 원칙).\n")
    L.append("- **개인 활약 P**: FotMob 월드컵 'Top stats' 개요(카테고리별 top-3, robots.txt Allow:/ 준수, /api 미사용) "
             "+ 대회 시상 + 이적 뉴스로 구성. FotMob 상위 리더보드와 큐레이션된 브레이크아웃만 P>0이며, 나머지는 "
             "P=0(개인 스포트라이트가 없으면 브레이크아웃이 아니다).\n")
    L.append("- **가치·이적료**: 기존 azz3 XGBoost 이적료 모델 재사용. 이적 전 가치 V0는 가능한 경우 큐레이션된 "
             "2026 시장가치, 없으면 2025/26 폼 기반 모델가치(2022 스냅샷에 기대므로 신인은 과소평가 → 큐레이션으로 보정). "
             "이적료는 destination 모듈의 **영입구단 프리미엄** 포함, 2014년 통화로 학습→2026년으로 환산(외삽 ~4.8배).\n")
    L.append("- **행선지**: destination 모듈의 과거(2014–2022) 빅5 영입 성향 + 리그 prior + 명성 가중. '만약 이적한다면' "
             "가장 적합한 구단이며 내부 정보가 아니다. 실제 이적과 다를 수 있다(예: 만잠비는 실제로는 아스톤 빌라행).\n")
    L.append("- **대상**: 빅5 리그 소속 월드컵 참가 선수만(모델가치 산출 가능 범위). 비(非)빅5 스타는 제외.\n")
    L.append(f"\n> 생성 {data['generated_utc']} · K={data['params']['K']} · 상위 {data['params']['top']}명\n")
    return "".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=16, help="board size")
    ap.add_argument("--top_k", type=int, default=5, help="destinations per player")
    args = ap.parse_args()

    _OUT.mkdir(parents=True, exist_ok=True)
    print(f"[1/3] 모델·풀·대회신호 로드 + 브레이크아웃 산출 (top={args.top}) …")
    data = build_results(args.top, args.top_k)

    # CSV (flat board), JSON (structured), report.md, web JSON.
    csv_rows = [{k: r[k] for k in ("rank", "name", "nation", "position", "age",
                "v0_eur", "v1_eur", "multiplier", "jump_eur", "wc_goals", "wc_assists",
                "headline_club", "fee_low_eur", "fee_high_eur", "mover_status")}
                for r in data["board"]]
    pd.DataFrame(csv_rows).to_csv(_OUT / "breakout_rankings.csv", index=False)
    with open(_OUT / "breakout_stars.json", "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=float)
    print(f"  -> {_OUT/'breakout_rankings.csv'} ({len(csv_rows)} rows)")
    print(f"  -> {_OUT/'breakout_stars.json'}")

    print("[2/3] 한국어 리포트 작성 …")
    (_WCS / "report.md").write_text(write_report(data), encoding="utf-8")
    print(f"  -> {_WCS/'report.md'}")

    print("[3/3] 웹 JSON export …")
    _WEB_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(_WEB_JSON, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=float)
    print(f"  -> {_WEB_JSON}")

    jp = data["james_pick"]
    print(f"\n=== 하메스 픽: {jp['name_ko']} ({jp['name']}) ===")
    for r in data["board"][:8]:
        print(f"  {r['rank']:>2}. {r['name']:20s} €{r['v0_eur']/1e6:>3.0f}M→€{r['v1_eur']/1e6:>3.0f}M "
              f"(×{r['multiplier']})  {r['headline_club']}")


if __name__ == "__main__":
    main()
