# 예측 리포트 — `2026-05-19T14:32:19Z`

> 이 리포트가 처음이라면 **[docs/report-guide.md](../../../docs/report-guide.md)** 참조.

| 필드 | 값 |
| --- | --- |
| Run ID (UTC) | `2026-05-19T14:32:19Z` |
| Model commit | `e428a8b` |
| 모델 | 이적료(EUR)에 대한 xgboost 회귀기 (log-deflated 타깃) |
| 학습 행 수 | 437 |
| 테스트 행 수 | 114 |
| Test MAE | **€14.4M** |
| Test Spearman ρ | **0.740** |

## 가장 비싼 홀드아웃 이적 Top 10

| 시즌 | 선수 | 행선지 | 실제 | 예측 | 오차 % | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- | --- | --- |
| 2021 | Jack Grealish | Manchester City | €117.5M | €74.2M | 37% | +SoT_per_90_Standard_shoot:+€17.65M \| +Ast_Per:+€12.94M \| +Cmp_percent_Long_pass:+€6.04M |
| 2021 | Romelu Lukaku | Chelsea FC | €113.0M | €65.8M | 42% | +Ast_Per:+€14.32M \| +Rec_percent_Receiving_poss:+€11.39M \| -Sh_Standard_shoot:+€10.47M |
| 2021 | Jadon Sancho | Manchester United | €85.0M | €60.8M | 29% | +SoT_per_90_Standard_shoot:+€21.70M \| +Ast_Per:+€12.46M \| -age_years:+€11.03M |
| 2022 | Wesley Fofana | Chelsea FC | €80.4M | €86.0M | 7% | +prior_market_value_eur:+€15.15M \| +Min_Playing:+€12.91M \| +Rec_percent_Receiving_poss:+€10.78M |
| 2022 | Casemiro | Manchester United | €70.7M | €34.4M | 51% | -age_years:+€21.45M \| +Ast_Per:+€11.17M \| +prior_market_value_eur:+€9.26M |
| 2022 | Alexander Isak | Newcastle United | €70.0M | €46.2M | 34% | +Ast_Per:+€18.95M \| +G+A_minus_PK_Per:+€16.18M \| +prior_market_value_eur:+€15.99M |
| 2022 | Marc Cucurella | Chelsea FC | €65.3M | €27.3M | 58% | +Min_Playing:+€14.15M \| +MP_Playing:+€13.55M \| -tenure_at_selling_club_years:+€11.09M |
| 2022 | Marc Cucurella | Chelsea FC | €65.3M | €48.8M | 25% | +prior_market_value_eur:+€25.08M \| +Ast_Per:+€17.22M \| -SoT_percent_Standard_shoot:+€6.91M |
| 2022 | Erling Haaland | Manchester City | €60.0M | €66.2M | 10% | +Rec_percent_Receiving_poss:+€16.08M \| -age_years:+€12.50M \| +Ast_Per:+€11.22M |
| 2021 | Ben White | Arsenal FC | €58.5M | €53.3M | 9% | +prior_market_value_eur:+€16.24M \| -MP_Playing:+€8.20M \| -age_years:+€7.56M |

## 가장 잘 맞춘 예측 5개 (가장 낮은 %오차)

| 시즌 | 선수 | 행선지 | 실제 | 예측 | 오차 % | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- | --- | --- |
| 2022 | Cristian Romero | Tottenham Hotspur | €50.0M | €49.3M | 1% | +contract_years_remaining:+€19.03M \| +Min_Playing:+€8.35M \| +MP_Playing:+€7.19M |
| 2021 | Bruno Guimarães | Newcastle United | €42.1M | €40.4M | 4% | +prior_market_value_eur:+€16.49M \| +Ast_Per:+€13.13M \| -age_years:+€11.33M |
| 2021 | Daniel James | Leeds United | €29.1M | €27.3M | 6% | +prior_market_value_eur:+€15.41M \| -age_years:+€8.00M \| +SoT_per_90_Standard_shoot:+€7.45M |
| 2022 | Wesley Fofana | Chelsea FC | €80.4M | €86.0M | 7% | +prior_market_value_eur:+€15.15M \| +Min_Playing:+€12.91M \| +Rec_percent_Receiving_poss:+€10.78M |
| 2022 | Philippe Coutinho | Aston Villa | €20.0M | €21.4M | 7% | +prior_market_value_eur:+€21.65M \| -age_years:+€10.31M \| +Ast_Per:+€6.92M |

## 가장 못 맞춘 예측 5개 (가장 높은 %오차)

| 시즌 | 선수 | 행선지 | 실제 | 예측 | 오차 % | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- | --- | --- |
| 2022 | Bernd Leno | Fulham FC | €3.6M | €22.0M | 511% | +prior_market_value_eur:+€45.37M \| -age_years:+€16.40M \| +Cmp_percent_Long_pass:+€10.41M |
| 2021 | Samuel Kalu | Watford FC | €3.0M | €14.0M | 366% | +prior_market_value_eur:+€20.56M \| -age_years:+€5.15M \| +SoT_per_90_Standard_shoot:+€3.97M |
| 2021 | Hassane Kamara | Watford FC | €4.0M | €18.6M | 365% | +prior_market_value_eur:+€26.07M \| -SoT_percent_Standard_shoot:+€3.26M \| +A_minus_xA_pass:+€2.32M |
| 2022 | Duje Caleta-Car | Southampton FC | €10.0M | €44.2M | 342% | +prior_market_value_eur:+€26.45M \| +contract_years_remaining:+€10.07M \| -Sh_Standard_shoot:+€8.31M |
| 2021 | Pierre Lees-Melou | Norwich City | €3.9M | €15.7M | 301% | +prior_market_value_eur:+€13.33M \| +G+A_minus_PK_Per:+€3.91M \| +contract_years_remaining:+€3.83M |

## 가상 선수 (2022 시즌 기준 인플레이션 반영)

| 프로필 | 포지션 | 나이 | 예측 이적료 | Top-3 스탯 개선안 (Δ 예측 이적료) |
| --- | --- | --- | --- | --- |
| 브레이크아웃 라이트 윙어, 23세 | Right Winger | 23 | €64.7M | -age_years:+€25.89M \| +SoT_per_90_Standard_shoot:+€21.81M \| +Ast_Per:+€20.90M |
| 베테랑 스트라이커, 31세 | Centre-Forward | 31 | €37.8M | -age_years:+€27.22M \| +SoT_per_90_Standard_shoot:+€18.00M \| +Ast_Per:+€14.27M |
| 플레이메이킹 미드필더, 28세 | Attacking Midfielder | 28 | €70.7M | -age_years:+€62.63M \| +SoT_per_90_Standard_shoot:+€29.28M \| +Ast_Per:+€15.73M |
| 수비형 미드필더, 26세 | Defensive Midfielder | 26 | €60.0M | -age_years:+€30.04M \| +contract_years_remaining:+€15.63M \| +MP_Playing:+€12.19M |
| 센터백, 27세 | Centre-Back | 27 | €75.8M | -age_years:+€46.24M \| +Ast_Per:+€14.00M \| +Cmp_percent_Short_pass:+€11.67M |
| 복권형 원더키드, 18세 | Left Winger | 18 | €45.0M | +SoT_per_90_Standard_shoot:+€16.59M \| +Min_Playing:+€11.66M \| +Cmp_percent_Short_pass:+€11.05M |

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
  - **age_years:** 23
  - **age_sq:** 529
  - **peak_distance:** 3
  - **prior_market_value_eur:** 25000000.0
  - **contract_years_remaining:** 3
  - **tenure_at_selling_club_years:** 2
  - **pos_forward:** 1
  - **pos_midfielder:** 0
  - **pos_defender:** 0
  - **window_winter:** 0
  - **nat_is_english:** 0
  - **nat_is_eu:** 1

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
  - **age_years:** 31
  - **age_sq:** 961
  - **peak_distance:** 5
  - **prior_market_value_eur:** 30000000.0
  - **contract_years_remaining:** 2
  - **tenure_at_selling_club_years:** 4
  - **pos_forward:** 1
  - **pos_midfielder:** 0
  - **pos_defender:** 0
  - **window_winter:** 0
  - **nat_is_english:** 0
  - **nat_is_eu:** 1

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
  - **age_years:** 28
  - **age_sq:** 784
  - **peak_distance:** 2
  - **prior_market_value_eur:** 45000000.0
  - **contract_years_remaining:** 3
  - **tenure_at_selling_club_years:** 3
  - **pos_forward:** 0
  - **pos_midfielder:** 1
  - **pos_defender:** 0
  - **window_winter:** 0
  - **nat_is_english:** 0
  - **nat_is_eu:** 1

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
  - **age_years:** 26
  - **age_sq:** 676
  - **peak_distance:** 0
  - **prior_market_value_eur:** 22000000.0
  - **contract_years_remaining:** 4
  - **tenure_at_selling_club_years:** 5
  - **pos_forward:** 0
  - **pos_midfielder:** 1
  - **pos_defender:** 0
  - **window_winter:** 0
  - **nat_is_english:** 0
  - **nat_is_eu:** 1

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
  - **age_years:** 27
  - **age_sq:** 729
  - **peak_distance:** 1
  - **prior_market_value_eur:** 30000000.0
  - **contract_years_remaining:** 4
  - **tenure_at_selling_club_years:** 4
  - **pos_forward:** 0
  - **pos_midfielder:** 0
  - **pos_defender:** 1
  - **window_winter:** 0
  - **nat_is_english:** 0
  - **nat_is_eu:** 1

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
  - **age_years:** 18
  - **age_sq:** 324
  - **peak_distance:** 8
  - **prior_market_value_eur:** 15000000.0
  - **contract_years_remaining:** 4
  - **tenure_at_selling_club_years:** 1
  - **pos_forward:** 1
  - **pos_midfielder:** 0
  - **pos_defender:** 0
  - **window_winter:** 0
  - **nat_is_english:** 0
  - **nat_is_eu:** 1

</details>

---

*`scripts/predict.py`에 의해 생성됨. 같은 디렉토리와 `predictions/latest/`에 CSV 동등본 있음. 감사 추적: `predictions/runs/runs.jsonl`.*
