# KBO 예측 프로젝트 — 지식 & DB 레퍼런스

> 목적: `kbo/` 모듈(야구 예측 파이프라인)의 아키텍처, 데이터 소스, **Supabase DB 스키마와 실제 내용**,
> 모델 파라미터, 일일 갱신 흐름을 한 문서로 정리한다. 온보딩·디버깅·재현의 기준 문서.
> 최초 작성 2026-08-18. 라이브 상태 스냅샷은 "8. DB 라이브 상태" 참고(작성 시점 값).

---

## 1. 한눈에 보기

`kbo/`는 축구 플랫폼(`src/` 몸값모델 + `pl/` 리그시뮬 + `web/`)의 **야구 형제 모듈**이다.

```
Naver Sports(로봇 허용 게이트웨이)  ─┐
                                    ├─ (일 1회 Vercel 크론) ─▶ Supabase 테이블 ─▶ TS 재계산·시뮬 ─▶ web
KBO /Record (참고용, 현재 로봇 차단) ─┘
```

- **Stage 1**: 각 팀의 공격/실점 전력을 인하우스 세이버메트릭스로 추정
- **Stage 2**: 144경기 정규시즌 + 포스트시즌 스텝래더를 몬테카를로
- **표시**: `web/app/kbo/page.tsx`(시즌 예측), `web/app/kbo/matchup`(승부 예측)

두 개의 실행 경로가 공존한다:
1. **오프라인 딥런(Python)** — `python -m kbo.scripts.run_prediction --sims 1000000`. 풀 부트업(선수단위) + 백테스트 진실원본.
2. **온라인 갱신(TypeScript, 크론 내)** — 신선한 시즌 성적으로 팀 레이팅을 만들어 축약 시뮬. 재배포 없이 수치가 웹에 반영됨.

---

## 2. 데이터 소스 (결정됨 — 함부로 바꾸지 말 것)

| 데이터 | 소스 | 비고 |
|---|---|---|
| 경기 결과·일정 | **Naver Sports schedule/games** | `kbo_games`로 적재. gameId 예: `20260801HHKT02026` |
| 팀·선수 시즌 스탯(원천 카운트) | **Naver Sports statistics 게이트웨이** | 로봇 클린. 50행/정렬 캡 → 8개 정렬 합집합으로 우회 |
| 박스스코어(전선수 출장 로그) | **Naver `schedule/games/{id}/record`** | 풀 로스터 복원용(리더보드 ~84명 한계 극복) |
| 고급지표(wOBA/wRC+/FIP/WAR) | **인하우스 계산** | 절대 스크랩하지 않음. Naver 발표값은 `naver_*` 컬럼에 교차검증용으로만 |
| (참고) KBO 공식 `/Record` | koreabaseball.com | **현재 robots.txt가 전면 차단** → 실사용 불가. 과거 스냅샷만 캐시에 존재 |

**금지선 (프로젝트 원칙):**
- **statiz.co.kr = OFF-LIMITS** — robots.txt `Disallow: /`, `anthropic-ai`/`Claude-Web` 명시 차단. 절대 스크래퍼 추가 금지.
- **고급지표는 계산, 스크랩 아님** — Naver가 WAR/wOBA를 발표해도 우리는 원천 카운트만 적재하고 사내 상수로 재계산.
- **KBO `/ws/*.asmx` 로봇 차단** → 실 라인업/선발예고 없음 → 매치업의 타순·로테이션은 실선수로 **모델링**.

관련 메모: `kbo-module`, `kbo-latest-results-source`, `kbo-naver-stats-endpoints`, `kbo-daily-scheduler`, `kbo-2026-validation`.

---

## 3. 일일 갱신 파이프라인 (Vercel 크론)

- **엔드포인트**: `web/app/api/cron/kbo-daily/route.ts` (Bearer `$CRON_SECRET`, Vercel이 전송). `maxDuration=300`(Fluid compute 필요).
- **스케줄**: `web/vercel.json` `0 20 * * *` = **05:00 KST**.
- **핵심 로직**: `web/lib/kbo/ingest.ts` → `runDailyIngest`
  - `naver.ts`: `fetchSeasonGames` / `fetchTeamStats` / `fetchAllHitters` / `fetchAllPitchers` / `fetchGameRecord`
  - `sabermetrics.ts`: `kbo/src/sabermetrics.py`의 TS 포트. 라이브 팀 합계에서 리그 상수 산출
  - `season-sim.ts`: 축약 시즌 시뮬 → `season-payload.ts` → `kbo_sim_snapshots(kind='season')`
  - `matchup.ts` + `boxscore.ts`: 박스스코어 집계 → 매치업 엔진 재료 → `kbo_sim_snapshots(kind='matchup')`
- **서빙**: `web/app/api/kbo/season/route.ts`가 라이브 스냅샷을 정적 `kbo.json` 위에 머지(백테스트·시드·연봉은 정적 유지). 오류 시 정적 폴백. ISR 1800s.

**쓰기 권한**: 모든 쓰기는 service-role 클라이언트(`web/lib/supabase/admin.ts`)가 RLS를 우회해서 수행. 클라이언트(anon)는 읽기만.

---

## 4. Supabase DB — 스키마

프로젝트: `fjwgcsdkfpyhlhykwoen` (URL/키는 `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
마이그레이션: `supabase/migrations/20260811090000_kbo_daily_stats.sql`, `..._20260813090000_kbo_boxscore_lines.sql`.
**네이밍 원칙**: 시즌은 컬럼(`season`)으로, 테이블명에 연도를 굽지 않음 → 2027은 새 행, 새 스키마 아님.
**RLS**: 5개 스탯 테이블 public-read + write 정책 없음. `kbo_ingest_runs`만 정책 없음(service-role 전용).

### 4.1 `kbo_games` — 경기 1행 (매치·득점)
PK `game_id`. 소스: Naver schedule.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| game_id | text PK | Naver gameId (`20260801HHKT02026`) |
| season | int | 시즌 |
| game_date | date | 경기일 |
| status | text | `RESULT` \| `BEFORE` \| `STARTED` \| `CANCEL` … |
| stadium | text | 구장 |
| away_team / home_team | text | 프랜차이즈 코드 (아래 6절) |
| away_score / home_score | int | 득점(미경기 null) |
| winner | text | `HOME` \| `AWAY` \| null(무/미경기) |
| cancel / suspended | bool | 취소/서스펜디드 |
| boxscore_ingested | bool | (2번째 마이그레이션 추가) 박스스코어 적재 마커 — 크론 증분용 |

인덱스: `(season, game_date)`, `(season, status)`.

### 4.2 `kbo_team_stats` — 팀-시즌 1행 (순위+집계)
PK `(season, team)`. 소스: Naver team statistics.
- 순위 필드: `ranking, games, win, lose, draw, wra(승률), game_behind, last_five('WWLWL'), streak('7승')`
- 공격 합계: `o_run, o_rbi, o_ab, o_hit, o_h2, o_h3, o_hr, o_sb, o_bbhp, o_kk, o_obp, o_slg, o_ops, o_hra`
- 실점 합계: `d_era, d_r, d_er, d_inning, d_hit, d_hr, d_kk, d_bbhp, d_err, d_whip, d_qs, d_save, d_hold`
- **주의**: Naver가 BB/HBP를 분리 null로 주고 합계 `bbhp`만 채움 → `o_bbhp`/`d_bbhp`에 볼넷+사구 합으로 저장.
- **주의(신선도)**: 이 테이블은 `kbo_games`보다 갱신이 늦거나 게임 수가 어긋날 수 있음. **현재 순위는 `kbo_games`의 RESULT에서 직접 계산하는 것이 신뢰도 높음** (아래 7절).

### 4.3 `kbo_hitter_stats` / `kbo_pitcher_stats` — 선수-시즌 1행
PK `(player_id, season)`. 소스: Naver players (+ boxscore).
- **원천 카운트(Naver)** 저장 후, **고급지표는 인하우스 재계산**:
  - 타자: `obp, slg, ops, woba, wrc_plus, war`
  - 투수: `era, whip, fip, war`
- **교차검증**: `naver_woba/naver_wrc_plus/naver_war`(타), `naver_era/naver_war`(투) — 서빙값 아님.
- `is_qualified`(규정타석/이닝), `source`(`naver_players` \| `boxscore`).
- Naver는 선수별 IBB/SF/SH/PA 미제공 → 0 근사, `PA=AB+BB+HP`(공개 명시).

### 4.4 `kbo_sim_snapshots` — 최신 시뮬 결과 (season/kind당 1행)
PK `(season, kind)`. `kind ∈ {'season','matchup'}`.
| 컬럼 | 설명 |
|---|---|
| payload | jsonb — season: `kbo.json` 모양(teams/standings/championship odds); matchup: `kbo-matchup.json` 모양(선수별 엔진 재료) |
| run_id, model_commit, sims | 프로비넌스 |
| generated_at | 생성 시각 |

`payload.teams[]` 필드: `ko, en, rank, championship, pennant, playoff(=top5 %), first, proj_wins, rs_per_game, ra_per_game, off_rating(100=avg), def_rating(100=avg, 높을수록 실점 적음)`.

### 4.5 `kbo_ingest_runs` — 크론 관측성 (service-role 전용)
`id, started_at, finished_at, status(running|success|error), season, trigger(cron|manual), games_upserted, hitters_upserted, pitchers_upserted, error, detail(jsonb)`. **public 정책 없음**(업스트림 에러 텍스트 유출 방지).

### 4.6 박스스코어 (2번째 마이그레이션)
- `kbo_boxscore_batters` / `kbo_boxscore_pitchers` — (game, player)당 1행. 전선수 출장 로그. public-read.
- 시즌 집계 뷰 `kbo_boxscore_batter_totals` / `..._pitcher_totals` — `security_invoker`(베이스 RLS 유지). 매치업 빌더가 이 작은 뷰를 읽음(원 ~14k 라인 직접 X).
- 크론은 RESULT 중 미적재 경기만 증분 수집(~220경기/런).

---

## 5. 모델 / 엔진 파라미터 (2026 재보정 반영)

| 파라미터 | 값 | 위치 | 의미 |
|---|---|---|---|
| DISPERSION_K | **3.70** | `game_model.py` / `season-sim.ts` / `matchup-sim.ts` | 음이항 득점분포 과산포 (var/mean) |
| HOME_FACTOR | **1.086** | 동일 | 홈 기대득점 배수 (2015-19+2026 풀 보정, 홈승 ~0.517 타깃) |
| rating_shrink | **0.70** | `team_build.build_team_ratings` / season-sim `DEFAULT_SHRINK` | 팀 레이팅을 리그평균으로 수축(과신 favorite 보정) |
| fip_blend | 0.25 | run_bottomup 파라미터 | 실점 추정에서 FIP 혼합비 |
| wexp_weight | 0.04 | 〃 | WAR→승리 환경 가중 |

**경기 승률 산식** (`season-sim.ts::expectedRuns` + `matchup-sim.ts::winProbExact`):
```
lgRg = 전팀 rs·ra 평균
muHome = clip(rs_home * ra_away / lgRg * HOME_FACTOR, 0.25, 20)
muAway = clip(rs_away * ra_home / lgRg,               0.25, 20)
pHome/pTie/pAway = NegBinom(mu, k=3.70) 이중합
```
정규시즌 순위는 승률(무 제외), 동률 시 승수. 포스트시즌: top5 스텝래더(WC BO1×2 → 준PO BO5 → PO BO5 → KS BO7, 상위시드 홈 2-2-1 / 2-3-2).

**검증(kbo-2026-validation)**: Spearman ρ(예측승–실제승%) ≈ **0.86**. 재보정 후 게임 Brier 0.243, 정확도 0.582. 남은 구조적 약점: 리그 R/G 앵커 소폭 과소, NC/한화 star-heavy 얕은 뎁스 과대평가, LG/NC/한화 실점(RA) 추정 오차.

---

## 6. 프랜차이즈 코드 맵

`SS`=삼성, `LG`=LG, `KT`=KT, `HT`=KIA, `OB`=두산, `HH`=한화, `NC`=NC, `LT`=롯데, `SK`=SSG, `WO`=키움.
별칭 이력(`kbo_team_meta.json`): SK→SSG, 넥센→키움.

---

## 7. DB 조회 레시피

```bash
# .env.local 로드 후
cd web && set -a && source .env.local && set +a
URL="$NEXT_PUBLIC_SUPABASE_URL"; KEY="$SUPABASE_SECRET_KEY"
H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY")

# 순위(정규시즌만!): kbo_games RESULT에서 계산하되 date >= '2026-03-28'로 시범경기 제외
curl -s "$URL/rest/v1/kbo_games?season=eq.2026&status=eq.RESULT&game_date=gte.2026-03-28&select=game_date,away_team,home_team,away_score,home_score,cancel,suspended&limit=2000" "${H[@]}"

# 전력 스냅샷(경기당 rs/ra, off/def, playoff%)
curl -s "$URL/rest/v1/kbo_sim_snapshots?season=eq.2026&kind=eq.season&select=generated_at,payload" "${H[@]}"

# 순위 교차검증(정답지): Naver 정규시즌 집계 — 이 값과 반드시 대조할 것
curl -s "https://api-gw.sports.naver.com/statistics/categories/kbo/seasons/2026/teams?gameType=REGULAR_SEASON" \
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://m.sports.naver.com/"
```

**⚠️ 시범경기(프리시즌) 오염 — 가장 큰 함정**: Naver `schedule/games`(→`kbo_games`/played.csv)에는 **시범경기 12경기/팀**이 `status=RESULT`로 섞여 있고 정규/시범 구분 필드가 없다. 전부 세면 승수·소화경기가 부풀려진다. **2026 정규시즌 개막 = 2026-03-28**(시범경기 ~3/24, 3/25~27 공백). 반드시 `game_date >= '2026-03-28'` 필터. 검증: 필터 전 한화 54-60(7위 오판) → 필터 후 **한화 48-54-3 .471 6위**(Naver REGULAR_SEASON 집계와 정확히 일치). 잔여 = **144 − 정규소화** (한화 39경기).

**남은 일정 주의**: `kbo_games`의 `BEFORE` 행에는 우천취소 재편성분이 빠져 잔여가 과소집계된다. 잔여 수는 `144 − 정규소화경기`로, 상대별 잔여는 **팀 간 16경기(홈 8·원정 8) 균형 라운드로빈**으로 재구성(`잔여_홈(i,j)=max(0,8−이미치른_홈(i,j))`). 참고: `kbo/outputs/hanwha-fall-baseball.html` 방법론.

---

## 8. DB 라이브 상태 (정규시즌 8/18 종료 기준, 개막 3/28)

> **⚠️ 아래는 정규시즌만(시범경기 12경기/팀 제외, `date>=2026-03-28`) 계산 — Naver REGULAR_SEASON 집계와 일치.**
> 시범경기를 포함하면 한화가 54-60 7위로 잘못 나온다(7절 함정 참고). 리포트/빙고판: `kbo/outputs/hanwha-fall-baseball.html`.

**적재 현황**: `kbo_games`에 시범경기 포함 RESULT 593행이 있으나 **정규시즌 RESULT는 533경기**(팀당 소화 101~111). hitters 78 · pitchers 156. 최신 크론 `success`, title pick 삼성 34.27%.

**현재 순위 (정규시즌만, 3/28~8/25):**

| # | 팀 | 승 | 패 | 무 | 승률 | 잔여(144−G) |
|--:|---|--:|--:|--:|--:|--:|
| 1 | KT | 64 | 42 | 3 | .604 | 35 |
| 2 | 삼성 | 65 | 44 | 3 | .596 | 32 |
| 3 | LG | 62 | 50 | 1 | .554 | 31 |
| 4 | KIA | 61 | 50 | 2 | .550 | 31 |
| 5 | 두산 | 59 | 50 | 4 | .541 | 31 |
| 6 | 롯데 | 50 | 59 | 2 | .459 | 33 |
| 7 | 한화 | 49 | 58 | 3 | .458 | 34 |
| 8 | NC | 48 | 57 | 2 | .457 | 37 |
| 9 | SSG | 46 | 64 | 5 | .418 | 29 |
| 10 | 키움 | 42 | 72 | 3 | .368 | 27 |

한화 7위(8/25 SSG전 1-7 패, 위 3팀 동반 승), 5위 두산과 **9.0G**차, 잔여 34. **조건부 시뮬 가을야구(top5) 진출 = 1.6%** (매직넘버 34경기 중 24승 ≈ 7할 페이스). 6·7·8위 롯데·한화·NC .457~.459 밀집이지만 한화 진출확률(1.6%)이 롯데(0.5%)·NC(1.0%)보다 높음(전력 우위). 추월확률: 두산 0.8/LG 0.9/KIA 0.4%. 전력 스냅샷(8/24 크론): 한화 rs 5.59 ra 5.40, 전력시뮬 59.7%. **잔여 34경기 전부 편성 완료(네이버, 최종전 10/7 원정 키움; 우천취소 14경기 9월 중순~10월에 삽입).** 트렌드: 8/18 10%→8/20 4.4%→8/22 6.7%→8/23 3.5%→8/25 1.6%. 일자별 리포트: `kbo/outputs/hanwha-fall-baseball-2026-08-{22,23,25}.html`.

**전력 스냅샷 (`kbo_sim_snapshots` season, 경기당 rs/ra·off/def·전력시뮬 top5%):**

| 팀 | rs | ra | off | def | proj_wins | 전력시뮬 top5% |
|---|--:|--:|--:|--:|--:|--:|
| 한화 | 5.58 | 5.29 | 109.8 | 95.9 | 69.2 | 67.4 |
| 삼성 | 5.52 | 4.78 | 108.8 | 106.3 | 75.0 | 92.8 |
| KT | 5.43 | 4.84 | 107.0 | 104.9 | 73.0 | 87.3 |
| KIA | 5.27 | 4.90 | 103.7 | 103.7 | 70.2 | 75.3 |
| NC | 5.13 | 5.30 | 101.0 | 95.9 | 63.7 | 31.5 |
| LG | 5.07 | 5.06 | 99.8 | 100.3 | 65.7 | 46.1 |
| SSG | 5.02 | 5.69 | 98.8 | 89.2 | 57.8 | 7.2 |
| 두산 | 4.77 | 4.54 | 94.0 | 111.9 | 68.4 | 67.0 |
| 롯데 | 4.75 | 5.00 | 93.5 | 101.6 | 62.2 | 24.7 |
| 키움 | 4.28 | 5.35 | 84.3 | 94.9 | 51.6 | 0.8 |

> **전력시뮬 top5%는 "0-0 재출발" 가정값**(현 순위 무시). 현 순위를 고정한 **조건부(남은경기) 시뮬**은 값이 크게 달라진다 —
> 예: 한화는 전력시뮬 67% vs 조건부 **9.0%**. 순위 예측에는 반드시 조건부 시뮬을 쓸 것.

---

## 9. 파일 지도

- `kbo/scripts/` — `run_prediction`, `run_bottomup`, `run_matchup`, `fetch_naver_games`, `fetch_data`, `fetch_boxscore_data`, `recalibrate`, `compare_actual_vs_sim`
- `kbo/src/` — `game_model`, `season_simulate`, `postseason`, `team_build`, `player_value`, `sabermetrics`, `matchup_export`, `naver_games`, `boxscore_data`, `live2026` …
- `kbo/outputs/` — `kbo.json`(정적 시즌), `kbo-matchup.json`(정적 매치업), `hanwha-fall-baseball.html`(가을야구 리포트)
- `web/lib/kbo/` — `naver.ts`, `ingest.ts`, `sabermetrics.ts`, `season-sim.ts`, `season-payload.ts`, `matchup.ts`, `boxscore.ts`, `franchise.ts`, `util.ts`
- `web/lib/matchup-sim.ts` — 브라우저 내 1M sim 마르코프 엔진(`negBinomPmf`, `winProbExact`)
- `web/app/kbo/` — 시즌 페이지 / 매치업 페이지 / `api/kbo/*` / `api/cron/kbo-daily`
- `kbo/METHODOLOGY.md`, `kbo/MATCHUP_GUIDE.md`, `kbo/report.md` — 상세 방법론

---

## 10. 배포/운영 체크리스트 & 미결

- 호스티드 Supabase에 두 마이그레이션 적용 완료(라이브 크론 동작 확인됨).
- `CRON_SECRET`은 `web/.env.local`(로컬) — 프로덕션은 `vercel env add CRON_SECRET` 필요.
- 박스스코어 백필: 크론이 ~220경기/런으로 자기추격(수 회) 또는 service key로 로컬 실행.
- 개선 여지(kbo-2026-validation): 리그 R/G 앵커 재조정, star-heavy 얕은 뎁스 모델링, LG/NC/한화 실점 추정 정교화.
