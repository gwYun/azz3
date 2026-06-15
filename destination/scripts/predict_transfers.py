"""밸류트랙 — 2026 여름 이적시장 핵심 이적 시나리오 예측.

사용자가 지정한 (선수 → 특정 구단) 시나리오의 이적료를 모델로 산출하고,
한국어 보도 리포트(destination/transfer-predictions.md)와 웹 데이터
(web/public/transfers.json)를 함께 생성한다.

세 가지 케이스:
  1) 이강인 (PSG → 아틀레티코 마드리드) — 단일 행선지.
  2) 음바페 (레알 → 맨시티 / 리버풀 / 사우디 리그) — 멀티 행선지.
     사우디 클럽은 모델 학습 데이터(빅5)에 없어 최고 지출 구단 프리미엄으로
     대략 추정.
  3) 살라 (리버풀 → 자유 계약) — 계약 만료. 모델은 유료 이적(>0)만 학습해
     €0(자유 이적)을 표현하지 못함. 계약 잔여 연수를 줄여 모델 반응을 보인다.

실행:  python -m destination.scripts.predict_transfers
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
_DEST = _HERE.parents[1]
_ROOT = _HERE.parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from destination.src import fee_bridge as fb  # noqa: E402
from destination.src import fx  # noqa: E402
from src.data import load_stathead_2526  # noqa: E402

_WEB = _ROOT / "web" / "public"

# Synthetic "Saudi league" club: not in the Big-5 training data, so apply the
# premium of the model's biggest spenders (Man City/Man Utd ~1.45), since PIF
# clubs pay at/above that ceiling for marquee names. Rough extrapolation.
_SAUDI_KEY = "__SAUDI_LEAGUE__"
_SAUDI_PREMIUM = 1.45


def _fee(art, profile, stat_row, club):
    X = fb.player_to_model_row(profile, stat_row, art=art, dest_club=club)
    return float(fb.predict_fee_eur(art, X)[0])


def _usd_man(eur: float) -> str:
    return fx.format_usd_man(fx.eur_to_usd(eur))


def _usd_en(eur: float) -> str:
    """English USD shorthand, e.g. '~$231M'."""
    return f"~${fx.eur_to_usd(eur) / 1e6:.0f}M"


def _keystats(r) -> dict:
    """Headline 2025/26 stats for the public web card."""
    def _i(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0
    return {"gls": _i(r["Gls"]), "ast": _i(r["Ast"]),
            "min": _i(r["Min_Playing"]), "mp": _i(r["MP_Playing"])}


def main() -> int:
    art = fb.load_model()
    art.buyer_premium_map[_SAUDI_KEY] = _SAUDI_PREMIUM
    stats = load_stathead_2526()

    def row(name):
        return stats[stats.Player == name].iloc[0]

    players = []

    # ---- 1) 이강인 ---------------------------------------------------------
    lee = {
        "name": "Lee Kang-in", "current_club": "Paris Saint-Germain",
        "current_league": "Ligue 1", "nationality": "Korea, South",
        "age": 24, "position_group": "midfielder",
        "prior_market_value_eur": 35e6, "contract_years_remaining": 2,
    }
    r = row("Lee Kang-in")
    lee_fee = _fee(art, lee, r, "Atlético de Madrid")
    players.append({
        "id": "lee", "name": "Lee Kang-in", "name_ko": "이강인",
        "from_ko": "파리 생제르맹", "from_en": "Paris Saint-Germain",
        "nat_ko": "대한민국", "nat_en": "South Korea", "age": 24, "pos": "MF/FW",
        "mv_eur": 35e6, "type": "single", "stats": _keystats(r),
        "scenarios": [{
            "to_ko": "아틀레티코 마드리드", "to_en": "Atlético de Madrid",
            "premium": round(art.buyer_premium_map.get("Atlético de Madrid", 1.0), 2),
            "fee_eur": lee_fee, "fee_usd_man": _usd_man(lee_fee), "fee_usd_en": _usd_en(lee_fee),
        }],
        "insight_ko": "아틀레티코 마드리드는 과거 영입에서 선수 시장가치에 거의 정확히 부합하는 금액을 지불해 온 구단으로, 행선지에 따른 추가 프리미엄이 사실상 없습니다. 따라서 예측 이적료는 이강인의 순수 모델 추정 가치와 같습니다.",
        "insight_en": "Atlético historically pays right at a player's market value, with no overpay premium, so the predicted fee equals Lee's pure model-implied value.",
    })

    # ---- 2) 음바페 ---------------------------------------------------------
    mbappe = {
        "name": "Kylian Mbappé", "current_club": "Real Madrid",
        "current_league": "LaLiga", "nationality": "France",
        "age": 26, "position_group": "forward",
        "prior_market_value_eur": 180e6, "contract_years_remaining": 3,
    }
    r = row("Kylian Mbappé")
    neutral = _fee(art, mbappe, r, None)
    scen = []
    for club, to_ko, to_en, rough in [
        ("Manchester City", "맨체스터 시티", "Manchester City", False),
        ("Liverpool FC", "리버풀", "Liverpool", False),
        (_SAUDI_KEY, "사우디 리그", "Saudi league", True),
    ]:
        f = _fee(art, mbappe, r, club)
        scen.append({
            "to_ko": to_ko, "to_en": to_en, "premium": round(art.buyer_premium_map.get(club, 1.0), 2),
            "fee_eur": f, "fee_usd_man": _usd_man(f), "fee_usd_en": _usd_en(f), "rough": rough,
        })
    players.append({
        "id": "mbappe", "name": "Kylian Mbappé", "name_ko": "킬리안 음바페",
        "from_ko": "레알 마드리드", "from_en": "Real Madrid",
        "nat_ko": "프랑스", "nat_en": "France", "age": 26, "pos": "FW",
        "mv_eur": 180e6, "type": "multi", "neutral_eur": neutral, "stats": _keystats(r),
        "scenarios": scen,
        "insight_ko": f"음바페의 순수 모델 추정 가치는 약 €{neutral/1e6:.0f}M입니다. 여기에 영입 구단의 과거 지출 성향이 더해집니다. 맨체스터 시티는 통상 시장가 대비 약 45% 더 지불해 가장 높은 금액을 제시합니다. 사우디 리그는 모델 학습 데이터(빅5 리그 한정)에 포함되지 않아, 최고 지출 구단(맨시티 급)의 프리미엄을 적용한 대략적 추정치입니다.",
        "insight_en": f"Mbappé's pure model value is about €{neutral/1e6:.0f}M; each club's historical overpay then shapes the fee. Manchester City typically pays ~45% over market, the highest bid. The Saudi league isn't in the model's training data (Big-5 only), so its figure applies the biggest spenders' premium as a rough extrapolation.",
    })

    # ---- 3) 살라 (자유 계약) ----------------------------------------------
    r = row("Mohamed Salah")
    contract_rows = []
    for cy in (3, 1, 0):
        sal = {
            "name": "Mohamed Salah", "current_club": "Liverpool FC",
            "current_league": "Premier League", "nationality": "Egypt",
            "age": 33, "position_group": "midfielder",
            "prior_market_value_eur": 28e6, "contract_years_remaining": cy,
        }
        f = _fee(art, sal, r, None)
        contract_rows.append({"years": cy, "fee_eur": f, "fee_usd_man": _usd_man(f)})
    players.append({
        "id": "salah", "name": "Mohamed Salah", "name_ko": "모하메드 살라",
        "from_ko": "리버풀", "from_en": "Liverpool",
        "nat_ko": "이집트", "nat_en": "Egypt", "age": 33, "pos": "FW/MF",
        "mv_eur": 28e6, "type": "free_agent", "stats": _keystats(r),
        "contract_scenarios": contract_rows, "free_fee_eur": 0,
        "insight_ko": "AI가 살라를 어떻게 예측하는지가 가장 흥미로운 지점입니다. 모델은 계약 잔여 연수가 줄수록 이적료를 낮춥니다(3년 기준 약 €21M → 1년 기준 약 €12M). 그러나 약 €12M에서 멈추며 **€0(자유 이적)에는 도달하지 못합니다.** 모델이 이적료가 공개된(0보다 큰) 이적만 학습했고, 자유 이적은 학습 데이터에서 제외됐기 때문입니다. 즉 모델은 '팔렸을 때의 가치'를 말할 뿐, 계약 만료로 공짜로 떠나는 현실은 구조적으로 보지 못합니다. 만 33세·시즌 7골로 이미 가치가 하락한 살라가 계약을 소진하면 실제 이적료는 €0입니다.",
        "insight_en": "How the AI prices Salah is the most interesting case. The model lowers the fee as his contract runs down (about €21M at 3 years left → €12M at 1 year), but it floors near €12M and never reaches €0, a free transfer. It was trained only on transfers with a disclosed fee above zero; free moves were excluded. So it tells you what he is worth if sold, not the reality of leaving for nothing. At 33 with 7 goals his value is already depressed; if he runs out his contract, the real fee is €0.",
    })

    out = {
        "_generated": "2026-06-15",
        "fx_eur_usd": fx.EUR_USD,
        "players": players,
    }
    _WEB.mkdir(parents=True, exist_ok=True)
    (_WEB / "transfers.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2, default=float), encoding="utf-8")
    print(f"-> {_WEB/'transfers.json'}")

    _write_report(out)
    print(f"-> {_DEST/'transfer-predictions.md'}")

    print("\n=== 헤드라인 ===")
    print(f"▲이강인: 파리 생제르맹 → 아틀레티코 마드리드 | {players[0]['scenarios'][0]['fee_usd_man']}")
    m = players[1]["scenarios"]
    print(f"▲음바페: 레알 → 맨시티 {m[0]['fee_usd_man']} / 리버풀 {m[1]['fee_usd_man']} / 사우디(추정) {m[2]['fee_usd_man']}")
    print(f"▲살라: 자유 계약 → 모델 추정 €{players[2]['contract_scenarios'][-1]['fee_eur']/1e6:.0f}M, 실제 자유 이적 시 €0")
    return 0


def _write_report(d: dict) -> None:
    eur = lambda v: f"€{v/1e6:.0f}M"

    def statline(p):
        s = p["stats"]
        return (f"*지난 시즌(2025/26) 주요 지표 — {s['mp']}경기 · "
                f"{s['gls']}골 · {s['ast']}도움 · {s['min']:,}분 출전*\n")

    L = []
    L.append("# 밸류트랙 — 2026 여름 이적시장 핵심 이적 예측\n")
    L.append("> 밸류트랙 이적료 예측 모델로, 화제의 세 이적 시나리오에 대한 예측 이적료를 산출했습니다. "
             "금액은 2026년 가치 기준이며, 영입 구단의 과거 지출 성향을 반영합니다.\n")

    lee = d["players"][0]; s = lee["scenarios"][0]
    L.append("\n## 1) 이강인 — 파리 생제르맹 → 아틀레티코 마드리드\n")
    L.append(statline(lee) + "\n")
    L.append(f"**예측 이적료 {eur(s['fee_eur'])} ({s['fee_usd_man']})**\n\n")
    L.append(lee["insight_ko"] + "\n")

    mb = d["players"][1]
    L.append("\n## 2) 킬리안 음바페 — 레알 마드리드 → 3개 행선지\n")
    L.append(statline(mb) + "\n")
    L.append(f"순수 모델 추정 가치 **{eur(mb['neutral_eur'])}**. 여기에 구단별 지출 성향이 더해집니다.\n\n")
    L.append("| 행선지 | 영입 프리미엄 | 예측 이적료 |\n|---|---:|---:|\n")
    for sc in mb["scenarios"]:
        tag = " (추정)" if sc.get("rough") else ""
        L.append(f"| {sc['to_ko']}{tag} | {sc['premium']:.2f} | {eur(sc['fee_eur'])} ({sc['fee_usd_man']}) |\n")
    L.append("\n" + mb["insight_ko"] + "\n")

    sa = d["players"][2]
    L.append("\n## 3) 모하메드 살라 — 리버풀 → 자유 계약 (계약 만료)\n")
    L.append(statline(sa) + "\n")
    L.append("계약 잔여 연수에 따른 모델 예측:\n\n")
    L.append("| 계약 잔여 | 모델 예측 이적료 |\n|---|---:|\n")
    for c in sa["contract_scenarios"]:
        yr = "0년 (계약 만료)" if c["years"] == 0 else f"{c['years']}년"
        L.append(f"| {yr} | {eur(c['fee_eur'])} ({c['fee_usd_man']}) |\n")
    L.append("\n" + sa["insight_ko"] + "\n")

    L.append("\n## 데이터 / 방법론\n")
    L.append("- **모델**: 밸류트랙의 이적료 예측 모델을 그대로 활용해 각 선수의 가치를 산출했습니다.\n")
    L.append("- **선수 입력**: 각 선수의 최신 시즌(2025/26) 실제 경기 스탯을 모델 입력으로 사용했습니다.\n")
    L.append("- **행선지 효과**: 영입 구단이 과거 시장가 대비 더(또는 덜) 지불해 온 성향을 반영합니다. 일부 구단(아틀레티코 등)은 프리미엄이 거의 없어 행선지가 금액을 바꾸지 않습니다.\n")
    L.append("- **사우디 리그**: 모델 학습 데이터에 포함되지 않아(빅5 한정), 최고 지출 구단의 프리미엄을 적용한 대략적 추정치입니다.\n")
    L.append("- **자유 이적의 한계**: 모델은 이적료가 공개된 유료 이적만 학습해 €0(자유 이적)을 직접 예측하지 못합니다. 살라처럼 계약이 만료되면 실제 이적료는 €0입니다.\n")
    (_DEST / "transfer-predictions.md").write_text("".join(L), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
