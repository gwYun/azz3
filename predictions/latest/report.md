# 예측 리포트 — `2026-05-01T08:33:51Z`

> 이 리포트가 처음이라면 **[docs/report-guide.md](../../../docs/report-guide.md)** 참조 — 모든 컬럼·스탯·SHAP 출력의 의미를 설명함.

| 필드 | 값 |
| --- | --- |
| Run ID (UTC) | `2026-05-01T08:33:51Z` |
| Model commit | `ceb8195` |
| 모델 | 이적료(EUR)에 대한 xgboost 회귀기 |
| 학습 행 수 | 437 |
| 테스트 행 수 | 114 |
| Test MAE | **€14.8M** |
| Test Spearman ρ | **0.332** |

> Spearman ρ ≈ 0.33 → 모델이 약 67%의 비율로 이적을 올바르게 랭킹한다는 의미 (랜덤 = 50%). 상대 랭킹 신호로 유용; 절대 예측은 엘리트급 이적을 과소평가하는 경향이 있음.

## 가장 비싼 홀드아웃 이적 Top 10

| 시즌 | 선수 | 행선지 | 실제 | 예측 | 오차 % | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- | --- | --- |
| 2021 | Jack Grealish | Manchester City | €117.5M | €53.2M | 55% | +Ast:+€12.21M \| +Starts_Playing:+€6.34M \| -Gls:+€5.27M |
| 2021 | Romelu Lukaku | Chelsea FC | €113.0M | €49.3M | 56% | +CrdY:+€6.69M \| -MP_Playing:+€4.10M \| +Gls_Per:+€2.74M |
| 2021 | Jadon Sancho | Manchester United | €85.0M | €58.8M | 31% | +Starts_Playing:+€5.68M \| +npxG_Expected:+€4.17M \| +Gls_Per:+€3.79M |
| 2022 | Wesley Fofana | Chelsea FC | €80.4M | €14.8M | 82% | +Starts_Playing:+€5.15M \| +xG_Expected:+€2.90M \| +Mins_Per_90_Playing:+€2.27M |
| 2022 | Casemiro | Manchester United | €70.7M | €35.4M | 50% | +xAG_Expected:+€7.77M \| -G+A_Per:+€6.80M \| -Ast:+€6.39M |
| 2022 | Alexander Isak | Newcastle United | €70.0M | €43.1M | 38% | -G+A_Per:+€10.45M \| -CrdY:+€4.19M \| +Starts_Playing:+€3.87M |
| 2022 | Marc Cucurella | Chelsea FC | €65.3M | €7.9M | 88% | +xG_Expected:+€9.39M \| +Starts_Playing:+€4.80M \| +Mins_Per_90_Playing:+€3.85M |
| 2022 | Marc Cucurella | Chelsea FC | €65.3M | €12.9M | 80% | -npxG_Expected:+€11.55M \| +xAG_Expected:+€11.37M \| -Mins_Per_90_Playing:+€8.40M |
| 2022 | Erling Haaland | Manchester City | €60.0M | €55.6M | 7% | +Starts_Playing:+€9.90M \| +xAG_Expected:+€6.47M \| +MP_Playing:+€4.56M |
| 2021 | Ben White | Arsenal FC | €58.5M | €19.1M | 67% | -xAG_Expected:+€35.85M \| -Mins_Per_90_Playing:+€14.00M \| +Gls_Per:+€10.97M |

## 가장 잘 맞춘 예측 5개 (가장 낮은 %오차)

| 시즌 | 선수 | 행선지 | 실제 | 예측 | 오차 % | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- | --- | --- |
| 2022 | Dwight McNeil | Everton FC | €24.0M | €23.6M | 2% | -Mins_Per_90_Playing:+€14.54M \| -MP_Playing:+€8.60M \| +Gls_Per:+€6.40M |
| 2022 | Raheem Sterling | Chelsea FC | €56.2M | €53.6M | 5% | +Starts_Playing:+€6.22M \| -xAG_Expected:+€5.96M \| -PKatt:+€3.54M |
| 2021 | Jean-Philippe Mateta | Crystal Palace | €11.0M | €11.6M | 6% | +Starts_Playing:+€6.33M \| +xG_Expected:+€4.36M \| +Mins_Per_90_Playing:+€2.62M |
| 2021 | Joachim Andersen | Crystal Palace | €17.5M | €16.5M | 6% | +Starts_Playing:+€7.17M \| +CrdY:+€2.52M \| +Gls_Per:+€2.23M |
| 2022 | Philippe Coutinho | Aston Villa | €20.0M | €18.8M | 6% | +Mins_Per_90_Playing:+€5.10M \| -npxG_Expected:+€4.81M \| +Starts_Playing:+€2.99M |

## 가장 못 맞춘 예측 5개 (가장 높은 %오차)

| 시즌 | 선수 | 행선지 | 실제 | 예측 | 오차 % | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- | --- | --- |
| 2021 | Craig Dawson | West Ham United | €2.3M | €26.1M | 1035% | +Starts_Playing:+€15.66M \| +MP_Playing:+€8.04M \| +Mins_Per_90_Playing:+€6.50M |
| 2022 | Willy Boly | Nottingham Forest | €2.6M | €18.7M | 621% | +xG_Expected:+€8.70M \| +Starts_Playing:+€5.21M \| +Mins_Per_90_Playing:+€3.67M |
| 2021 | Moussa Sissoko | Watford FC | €3.5M | €23.1M | 560% | +xG_Expected:+€8.66M \| +MP_Playing:+€8.29M \| +Gls_Per:+€7.74M |
| 2021 | Samuel Kalu | Watford FC | €3.0M | €16.8M | 459% | +xAG_Expected:+€6.63M \| -CrdY:+€6.57M \| +G+A_Per:+€5.64M |
| 2021 | Pierre Lees-Melou | Norwich City | €3.9M | €21.6M | 453% | +Starts_Playing:+€14.69M \| -G+A_Per:+€13.74M \| -xG_Expected:+€6.09M |

## 가상 선수

서로 다른 포지션·나이·스탯 프로필을 가진 6개의 아키타입.
목적은 (a) 선수 타입 전반에서 모델 반응을 sanity-check, (b) 모델이 잘 보정된 곳과 그렇지 않은 곳(수비수는 알려진 약점)을 드러내기, (c) 아키타입별 SHAP "이 스탯을 개선하라" 출력을 보여주기.

| 프로필 | 포지션 | 나이 | 예측 이적료 | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- |
| 브레이크아웃 라이트 윙어, 23세 | Right Winger | 23 | €54.5M | +G+A_Per:+€10.95M \| -CrdY:+€2.85M \| +Ast:+€2.67M |
| 베테랑 스트라이커, 31세 | Centre-Forward | 31 | €33.1M | +Starts_Playing:+€10.44M \| -CrdY:+€9.67M \| +Gls:+€9.37M |
| 플레이메이킹 미드필더, 28세 | Attacking Midfielder | 28 | €58.6M | +CrdY:+€15.50M \| +G+A_Per:+€10.96M \| +Gls:+€10.17M |
| 수비형 미드필더, 26세 | Defensive Midfielder | 26 | €16.7M | -npxG_Expected:+€10.60M \| -xAG_Expected:+€8.53M \| +Starts_Playing:+€6.78M |
| 센터백, 27세 | Centre-Back | 27 | €20.2M | -xAG_Expected:+€17.85M \| -Mins_Per_90_Playing:+€10.37M \| -npxG_Expected:+€9.39M |
| 복권형 원더키드, 18세 | Left Winger | 18 | €15.7M | +xAG_Expected:+€18.07M \| +Ast:+€12.07M \| -CrdY:+€2.93M |

### 아키타입별 입력 스탯

<details><summary><b>브레이크아웃 라이트 윙어, 23세</b> &mdash; Right Winger, 23세 &mdash; 입력 스탯</summary>

  - **MP_Playing:** 32
  - **Starts_Playing:** 28
  - **Min_Playing:** 2520
  - **Mins_Per_90_Playing:** 28.0
  - **Gls:** 9
  - **Ast:** 6
  - **G_minus_PK:** 9
  - **PK:** 0
  - **PKatt:** 0
  - **CrdY:** 4
  - **CrdR:** 0
  - **Gls_Per:** 0.32
  - **Ast_Per:** 0.21
  - **G+A_Per:** 0.54
  - **G_minus_PK_Per:** 0.32
  - **G+A_minus_PK_Per:** 0.54
  - **xG_Expected:** 7.8
  - **npxG_Expected:** 7.8
  - **xAG_Expected:** 5.2
  - **npxG+xAG_Expected:** 13.0
  - **xG_Per:** 0.28
  - **xAG_Per:** 0.19
  - **xG+xAG_Per:** 0.47
  - **npxG_Per:** 0.28
  - **npxG+xAG_Per:** 0.47

</details>

<details><summary><b>베테랑 스트라이커, 31세</b> &mdash; Centre-Forward, 31세 &mdash; 입력 스탯</summary>

  - **MP_Playing:** 30
  - **Starts_Playing:** 26
  - **Min_Playing:** 2300
  - **Mins_Per_90_Playing:** 25.6
  - **Gls:** 18
  - **Ast:** 3
  - **G_minus_PK:** 16
  - **PK:** 2
  - **PKatt:** 3
  - **CrdY:** 3
  - **CrdR:** 0
  - **Gls_Per:** 0.7
  - **Ast_Per:** 0.12
  - **G+A_Per:** 0.82
  - **G_minus_PK_Per:** 0.62
  - **G+A_minus_PK_Per:** 0.74
  - **xG_Expected:** 16.2
  - **npxG_Expected:** 13.9
  - **xAG_Expected:** 2.1
  - **npxG+xAG_Expected:** 16.0
  - **xG_Per:** 0.63
  - **xAG_Per:** 0.08
  - **xG+xAG_Per:** 0.71
  - **npxG_Per:** 0.54
  - **npxG+xAG_Per:** 0.62

</details>

<details><summary><b>플레이메이킹 미드필더, 28세</b> &mdash; Attacking Midfielder, 28세 &mdash; 입력 스탯</summary>

  - **MP_Playing:** 35
  - **Starts_Playing:** 33
  - **Min_Playing:** 2970
  - **Mins_Per_90_Playing:** 33.0
  - **Gls:** 6
  - **Ast:** 13
  - **G_minus_PK:** 5
  - **PK:** 1
  - **PKatt:** 1
  - **CrdY:** 5
  - **CrdR:** 0
  - **Gls_Per:** 0.18
  - **Ast_Per:** 0.39
  - **G+A_Per:** 0.57
  - **G_minus_PK_Per:** 0.15
  - **G+A_minus_PK_Per:** 0.55
  - **xG_Expected:** 5.5
  - **npxG_Expected:** 4.7
  - **xAG_Expected:** 9.8
  - **npxG+xAG_Expected:** 14.5
  - **xG_Per:** 0.17
  - **xAG_Per:** 0.3
  - **xG+xAG_Per:** 0.47
  - **npxG_Per:** 0.14
  - **npxG+xAG_Per:** 0.44

</details>

<details><summary><b>수비형 미드필더, 26세</b> &mdash; Defensive Midfielder, 26세 &mdash; 입력 스탯</summary>

  - **MP_Playing:** 33
  - **Starts_Playing:** 31
  - **Min_Playing:** 2790
  - **Mins_Per_90_Playing:** 31.0
  - **Gls:** 1
  - **Ast:** 2
  - **G_minus_PK:** 1
  - **PK:** 0
  - **PKatt:** 0
  - **CrdY:** 9
  - **CrdR:** 1
  - **Gls_Per:** 0.03
  - **Ast_Per:** 0.06
  - **G+A_Per:** 0.1
  - **G_minus_PK_Per:** 0.03
  - **G+A_minus_PK_Per:** 0.1
  - **xG_Expected:** 0.9
  - **npxG_Expected:** 0.9
  - **xAG_Expected:** 1.6
  - **npxG+xAG_Expected:** 2.5
  - **xG_Per:** 0.03
  - **xAG_Per:** 0.05
  - **xG+xAG_Per:** 0.08
  - **npxG_Per:** 0.03
  - **npxG+xAG_Per:** 0.08

</details>

<details><summary><b>센터백, 27세</b> &mdash; Centre-Back, 27세 &mdash; 입력 스탯</summary>

  - **MP_Playing:** 34
  - **Starts_Playing:** 33
  - **Min_Playing:** 2970
  - **Mins_Per_90_Playing:** 33.0
  - **Gls:** 2
  - **Ast:** 1
  - **G_minus_PK:** 2
  - **PK:** 0
  - **PKatt:** 0
  - **CrdY:** 6
  - **CrdR:** 1
  - **Gls_Per:** 0.06
  - **Ast_Per:** 0.03
  - **G+A_Per:** 0.09
  - **G_minus_PK_Per:** 0.06
  - **G+A_minus_PK_Per:** 0.09
  - **xG_Expected:** 1.5
  - **npxG_Expected:** 1.5
  - **xAG_Expected:** 0.6
  - **npxG+xAG_Expected:** 2.1
  - **xG_Per:** 0.05
  - **xAG_Per:** 0.02
  - **xG+xAG_Per:** 0.07
  - **npxG_Per:** 0.05
  - **npxG+xAG_Per:** 0.07

</details>

<details><summary><b>복권형 원더키드, 18세</b> &mdash; Left Winger, 18세 &mdash; 입력 스탯</summary>

  - **MP_Playing:** 22
  - **Starts_Playing:** 14
  - **Min_Playing:** 1300
  - **Mins_Per_90_Playing:** 14.4
  - **Gls:** 5
  - **Ast:** 4
  - **G_minus_PK:** 5
  - **PK:** 0
  - **PKatt:** 0
  - **CrdY:** 2
  - **CrdR:** 0
  - **Gls_Per:** 0.35
  - **Ast_Per:** 0.28
  - **G+A_Per:** 0.62
  - **G_minus_PK_Per:** 0.35
  - **G+A_minus_PK_Per:** 0.62
  - **xG_Expected:** 4.0
  - **npxG_Expected:** 4.0
  - **xAG_Expected:** 3.2
  - **npxG+xAG_Expected:** 7.2
  - **xG_Per:** 0.28
  - **xAG_Per:** 0.22
  - **xG+xAG_Per:** 0.5
  - **npxG_Per:** 0.28
  - **npxG+xAG_Per:** 0.5

</details>

---

*`scripts/predict.py`에 의해 생성됨. 같은 디렉토리와 `predictions/latest/`에 CSV 동등본 있음. 감사 추적: `predictions/runs/runs.jsonl`.*
