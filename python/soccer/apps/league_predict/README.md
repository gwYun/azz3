# league_predict — 빅5 리그 가치 기반 승부예측

몸값(①) → 시너지(②) → 시뮬(③) 구조를 유지하되, 입력은 모두 Naver 데이터(Supabase
`soccer_games`, `soccer_player_stats`)이고 득점 계수는 실제 경기 결과로 추정한다.

```
Naver 선수 시즌 스탯 ──▶ 이적료 모델(가치 체인) ──▶ synergy.team_strength ──▶ 클럽 프리시즌 rating
                                                                               │
Naver 경기 결과 ─────────────────────────────▶ Poisson + Dixon-Coles (value / results / hybrid)
```

| 파일 | 역할 |
|---|---|
| `data.py` | Supabase에서 경기·선수 테이블 로드 (`python/data/cache/league_predict/`에 캐시) |
| `club_value.py` | 선수 가치 체인 + 클럽 프리시즌 rating |
| `match_model.py` | value / results / hybrid 세 변형을 하나의 우도로 적합 |
| `backtest.py` | 주간 walk-forward 백테스트, 결과 CSV·JSON 기록 |

| `publish_ratings.py` | 클럽 rating을 Supabase `soccer_club_ratings`에 게시 (시즌당 1회) |

실행 (python/에서): `../.venv/bin/python -m soccer.apps.league_predict.backtest` (약 50초)

**서비스 경로.** 매일 돌아가는 모델은 TS 포트(`web/lib/soccer/match-model.ts`, Python과
소수 4자리까지 일치)가 `soccer_club_ratings`를 읽어 적합한다. 경기 결과 수집 직후
`/api/cron/soccer-daily`가 킥오프 전 예측을 `soccer_match_predictions`에 고정 저장하고,
시즌 시뮬을 갱신한다. `/api/cron/soccer-articles`는 경기 다음 날 팀별 리포트(리뷰 +
프리뷰)를 발행한다. K리그1은 스플릿 이후 일정이 공개되기 전까지 상·하위 6팀 스플릿
라운드를 시뮬레이션 안에서 합성한다.

## 가치 체인

- 시즌 S 종료 시점 선수 가치 = 이적료 모델(직전 가치, Naver S시즌 스탯).
- 체인 시드는 2022/23 Transfermarkt 가치 한 번뿐이다. Naver는 한글 이름만 제공하므로
  생년월일로 매칭하고, 동일 생일은 국적으로 구분한다. 국적 매핑(한글→영문)은 생일이
  유일한 쌍에서 학습하며, 수기 테이블은 쓰지 않는다. 1,507명이 매칭됐고 시드 비율은
  41%(2023)에서 27%(2026)로 줄어든다.
- 시즌 S 예측에 쓰는 값은 S 이전 시즌까지의 최신 체인 값이다(룩어헤드 없음).
  값이 없는 선수는 로스터 중앙값을 쓴다(기존 WC·PL 파이프라인과 같은 규칙).
- 클럽 rating은 Naver S시즌 로스터를 `synergy.team_strength`로 집계한 뒤, 리그·시즌
  안에서 log z-score로 바꾼 값이다.

**알려진 한계.** 시즌 S 로스터는 Naver의 시즌 S 소속 기준이라 1월 영입이 포함된다.
프리시즌 rating과 최종 승점의 스피어만 상관은 2024·2025 평균 0.656이다. 2022 TM 값만
그대로 쓴 경우(0.660)와 차이가 없고, 전 시즌 승점 기준선(0.69)보다 약간 낮다. 즉 현재
체인의 스탯 업데이트는 정보를 더하지 못한다. 시드되지 않은 선수(59~73%)가 중앙값에서
출발하는 것이 주원인으로 추정된다(TODOS 참조).

## 백테스트 (2026-10-07)

프로토콜: 리그별로 매주 월요일 컷오프에서 그 이전 경기(2023/24~)만으로 재적합하고
다음 7일 경기를 예측한다. 감쇠 ξ와 ridge pen은 2024/25에서만 고르고, 2025/26과
2026/27(진행분)은 손대지 않은 홀드아웃이다. 선택값: value ξ=0.004, results ξ=0.002·pen=2,
hybrid ξ=0.004·pen=8.

홀드아웃 2,001경기 (RPS·log loss는 낮을수록 좋다):

| 모델 | RPS | log loss | Brier | 적중률 |
|---|---|---|---|---|
| hybrid (가치 + 결과 잔차) | **0.2025** | **0.9941** | **0.5922** | 51.8% |
| results (Dixon-Coles) | 0.2030 | 0.9955 | 0.5931 | 51.7% |
| value (가치만) | 0.2070 | 1.0069 | 0.6013 | 50.4% |
| 기준선 (H/D/A 빈도) | 0.2296 | 1.0732 | 0.6490 | 43.9% |

RPS 차이 (부트스트랩 95% 신뢰구간):
- hybrid − results: −0.0005 [−0.0022, +0.0012] → 유의하지 않음.
- value − results: +0.0040 [+0.0006, +0.0074] → 가치만으로는 결과 기반보다 유의하게 나쁨.
- hybrid − value: −0.0045 [−0.0070, −0.0021] → 결과 잔차가 유의하게 개선.

승격팀이 낀 경기(555경기)에서는 hybrid 0.1933, results 0.1960, value 0.1968로 hybrid가
가장 낫다. 결과 이력이 없는 팀에서 가치 prior가 실제로 작동한다는 뜻이다.

보정: 세 모델 모두 과신하지 않는다. hybrid는 예측 0.60일 때 실제 0.65, 0.80일 때
0.83으로, 강팀 쪽에서 오히려 약간 보수적이다(KBO 시뮬의 과신 문제는 재현되지 않음).

정리하면, 가치는 기준선 대비 RPS를 약 10% 줄일 만큼 승부를 설명한다. 다만 결과가
담고 있는 정보가 더 많으므로, 서비스 모델은 가치를 prior로 두고 결과로 보정하는
hybrid가 맞다. 가치 체인의 품질(시드 커버리지)을 올리는 것이 다음 개선 레버다.

산출물: `backtest_holdout.csv`, `backtest_per_league.csv`, `backtest_tuning.csv`,
`backtest_preds_{value,results,hybrid}.csv`, `backtest_summary.json`.
