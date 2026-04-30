# Prediction Report — `2026-04-30T14:14:36Z`

| Field | Value |
| --- | --- |
| Run ID (UTC) | `2026-04-30T14:14:36Z` |
| Model commit | `334d4a6` |
| Model | xgboost regressor on transfer fee (EUR) |
| Train rows | 437 |
| Test rows | 114 |
| Test MAE | **€14.8M** |
| Test Spearman ρ | **0.332** |

> Spearman ρ ≈ 0.33 means the model ranks transfers correctly about
> 67% of the time (random = 50%). Useful as a relative
> ranking signal; absolute predictions tend to underestimate elite-tier transfers.

## Top 10 highest-fee held-out transfers

| Season | Player | To | Actual | Predicted | Err % | Top-3 stat improvements (Δ predicted fee) |
| --- | --- | --- | --- | --- | --- | --- |
| 2021 | Jack Grealish | Manchester City | €117.5M | €53.2M | 54.727 | +Ast:+€12.21M | +Starts_Playing:+€6.34M | -Gls:+€5.27M |
| 2021 | Romelu Lukaku | Chelsea FC | €113.0M | €49.3M | 56.399 | +CrdY:+€6.69M | -MP_Playing:+€4.10M | +Gls_Per:+€2.74M |
| 2021 | Jadon Sancho | Manchester United | €85.0M | €58.8M | 30.874 | +Starts_Playing:+€5.68M | +npxG_Expected:+€4.17M | +Gls_Per:+€3.79M |
| 2022 | Wesley Fofana | Chelsea FC | €80.4M | €14.8M | 81.576 | +Starts_Playing:+€5.15M | +xG_Expected:+€2.90M | +Mins_Per_90_Playing:+€2.27M |
| 2022 | Casemiro | Manchester United | €70.7M | €35.4M | 49.851 | +xAG_Expected:+€7.77M | -G+A_Per:+€6.80M | -Ast:+€6.39M |
| 2022 | Alexander Isak | Newcastle United | €70.0M | €43.1M | 38.470 | -G+A_Per:+€10.45M | -CrdY:+€4.19M | +Starts_Playing:+€3.87M |
| 2022 | Marc Cucurella | Chelsea FC | €65.3M | €7.9M | 87.916 | +xG_Expected:+€9.39M | +Starts_Playing:+€4.80M | +Mins_Per_90_Playing:+€3.85M |
| 2022 | Marc Cucurella | Chelsea FC | €65.3M | €12.9M | 80.210 | -npxG_Expected:+€11.55M | +xAG_Expected:+€11.37M | -Mins_Per_90_Playing:+€8.40M |
| 2022 | Erling Haaland | Manchester City | €60.0M | €55.6M | 7.384 | +Starts_Playing:+€9.90M | +xAG_Expected:+€6.47M | +MP_Playing:+€4.56M |
| 2021 | Ben White | Arsenal FC | €58.5M | €19.1M | 67.284 | -xAG_Expected:+€35.85M | -Mins_Per_90_Playing:+€14.00M | +Gls_Per:+€10.97M |

## 5 best predictions (lowest %error)

| Season | Player | To | Actual | Predicted | Err % | Top-3 stat improvements (Δ predicted fee) |
| --- | --- | --- | --- | --- | --- | --- |
| 2022 | Dwight McNeil | Everton FC | €24.0M | €23.6M | 1.525 | -Mins_Per_90_Playing:+€14.54M | -MP_Playing:+€8.60M | +Gls_Per:+€6.40M |
| 2022 | Raheem Sterling | Chelsea FC | €56.2M | €53.6M | 4.571 | +Starts_Playing:+€6.22M | -xAG_Expected:+€5.96M | -PKatt:+€3.54M |
| 2021 | Jean-Philippe Mateta | Crystal Palace | €11.0M | €11.6M | 5.694 | +Starts_Playing:+€6.33M | +xG_Expected:+€4.36M | +Mins_Per_90_Playing:+€2.62M |
| 2021 | Joachim Andersen | Crystal Palace | €17.5M | €16.5M | 5.853 | +Starts_Playing:+€7.17M | +CrdY:+€2.52M | +Gls_Per:+€2.23M |
| 2022 | Philippe Coutinho | Aston Villa | €20.0M | €18.8M | 6.040 | +Mins_Per_90_Playing:+€5.10M | -npxG_Expected:+€4.81M | +Starts_Playing:+€2.99M |

## 5 worst predictions (highest %error)

| Season | Player | To | Actual | Predicted | Err % | Top-3 stat improvements (Δ predicted fee) |
| --- | --- | --- | --- | --- | --- | --- |
| 2021 | Craig Dawson | West Ham United | €2.3M | €26.1M | 1035.471 | +Starts_Playing:+€15.66M | +MP_Playing:+€8.04M | +Mins_Per_90_Playing:+€6.50M |
| 2022 | Willy Boly | Nottingham Forest | €2.6M | €18.7M | 620.799 | +xG_Expected:+€8.70M | +Starts_Playing:+€5.21M | +Mins_Per_90_Playing:+€3.67M |
| 2021 | Moussa Sissoko | Watford FC | €3.5M | €23.1M | 560.433 | +xG_Expected:+€8.66M | +MP_Playing:+€8.29M | +Gls_Per:+€7.74M |
| 2021 | Samuel Kalu | Watford FC | €3.0M | €16.8M | 458.916 | +xAG_Expected:+€6.63M | -CrdY:+€6.57M | +G+A_Per:+€5.64M |
| 2021 | Pierre Lees-Melou | Norwich City | €3.9M | €21.6M | 452.718 | +Starts_Playing:+€14.69M | -G+A_Per:+€13.74M | -xG_Expected:+€6.09M |

## Synthetic fake-player

> A 23-year-old right winger with a strong-but-not-elite season. The point is
> to validate the model produces sensible predictions on inputs that aren't in
> the training set, and that the SHAP top-3 surfaces the kind of stat-improvements
> a young attacker would actually be advised to chase.

| Field | Value |
| --- | --- |
| Name | Fictional Forward, 23yo |
| Position | Right Winger |
| Age | 23 |
| Predicted fee | **€54.5M** |
| Top-3 stat improvements | `+G+A_Per:+€10.95M | -CrdY:+€2.85M | +Ast:+€2.67M` |

**Input stats used:**

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

---

*Generated by `scripts/predict.py`. CSV equivalents in this same directory and in `predictions/latest/`. Audit trail: `predictions/runs/runs.jsonl`.*
