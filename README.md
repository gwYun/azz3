# azz3 — 스탯 개선 반사실(counterfactual) 기반 축구 이적료 예측기

이전 시즌 FBref Big-5 스탯을 바탕으로 프리미어리그로의 인바운드 이적료를 예측하고, 그 중 어느 스탯 3개를 개선했더라면 예측 이적료가 가장 크게 올랐을지를 보여주는 노트북 MVP.

상태: 1주차 구현 완료. 1일차 표본 크기 게이트 **통과** (조인된 행 551개). 전체 설계 문서 + 테스트 플랜은 `~/.gstack/projects/azz3/` 참고.

## 배경

원래 계획은 FBref + Transfermarkt 라이브 스크래이핑이었음. 1주차에 네 번의 현실 벽에 부딪혔고, 매번 사용자와 논의해 결정함:

- **I1:** soccerdata 1.8이 Transfermarkt 지원을 중단 → ScraperFC로 시도.
- **I2:** ScraperFC의 TM 이적 이력 파서가 망가져 있음 → 타깃을 TM 시장 가치로 전환.
- **I3:** FBref가 soccerdata와 ScraperFC 양쪽 모두에 Cloudflare로 차단됨 → 스탯 출처를 Understat으로 전환.
- **I4 (해결됨):** `JaseZiv/worldfootballR_data` GitHub 저장소를 발견 — FBref + TM 이적 + TM 시장 가치의 갱신된 RDS 덤프를, raw GitHub URL로 서빙 (Cloudflare 없음). 단일 다운로드, 라이브 스크래이핑 없음. **I2와 I3 완전 철회** — 본래 목표였던 이적료 예측 + FBref Big-5 풀 스탯으로 복귀.

최종 데이터 레이어: `JaseZiv/worldfootballR_data`에서 RDS 파일 8개(총 약 12 MB) 다운로드, 순수 파이썬 `rdata` 라이브러리로 읽고, 정규화된 이름 + 직전 시즌 + 나이 기준으로 JOIN. 런타임 스크래이핑 없음. 커버리지: 2010-2023 시즌 스탯, 2010-2022 이적 (공개된 이적료 약 24,000건, EUR).

## 셋업

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
brew install libomp   # macOS 한정 — xgboost가 요구함
```

## 레이아웃

```
src/                 # 테스트 가능한 모듈
  config.py          # 상수 (SEASONS, leagues, MIN_TRAIN_N, fuzzy 임계값 등)
  data.py            # worldfootballR_data RDS 다운로드 + JOIN
  match.py           # 계층형 선수 ID 매칭 (라이브 스크래이핑 계획의 레거시)
  features.py        # 통계적 특성 선택 (LASSO + RFE + MI)
  model.py           # 시간적 분할 + 선수 disjoint + xgboost + drift 메트릭
  shap_utils.py      # TreeExplainer + ±1 SD 섭동(perturbation) 평가
tests/               # pytest, src/를 미러링
tests/eval/          # SHAP 평가 + 홀드아웃 MAE 회귀
scripts/
  sanity_check.py    # 1일차 게이트 (다운로드 + JOIN + 카운트)
  full_ingest.py     # 레거시 라이브 스크래이핑 (더 이상 사용 안 함, 참고용)
notebooks/           # 데모 / 오케스트레이션 (3주차 예정)
data/                # 로컬 캐시, .gitignored
```

## 워크플로우

### 1일차 (완료)
```bash
.venv/bin/python scripts/sanity_check.py
# 기대 결과: PASS, 조인 행 551개, 중앙값 이적료 €14.4M
```

### 2주차 (진행 중)
- 이적 × 직전 시즌 스탯 조인 테이블에서 특성 선택
- 선수 disjoint를 강제한 시간 기반 분할 (2014-2020 train, 2021-2022 test)
- xgboost + 선형 베이스라인 학습; €로 MAE, Spearman ρ, 2020년 전/후 drift 리포트
- TreeExplainer로 SHAP, 선수당 top-3 ±1 SD 섭동

### 3주차
- 내부 데모, 팀원 화면 공유

## 예측 리포트 읽는 법

`scripts/predict.py`를 실행할 때마다 CSV 옆에 사람이 읽기 좋은 `report.md`가 생성됨 (`predictions/latest/`와 타임스탬프가 찍힌 `predictions/runs/{ts}/` 양쪽 모두). 모든 컬럼, 스탯, SHAP 출력에 대한 자세한 설명 — xG / xAG / npxG의 의미, 각 특성이 예측에 어떻게 영향을 주는지, 모델의 알려진 결함 등 — 은 **[docs/report-guide.md](docs/report-guide.md)** 참고.

## 테스트

```bash
.venv/bin/python -m pytest tests/ -v
```

현재 11개의 통과 테스트가 가장 위험도 높은 경로들을 커버함.

## 범위

**포함:** Big 5 리그 → 프리미어리그 인바운드 이적, 2014-2022 공개 이적료, 이름+나이 기준으로 조인된 직전 시즌 FBref 스탯, 선수당 top-3 스탯에 대한 SHAP 기반 "어느 스탯을 개선할 것인가" 반사실 분석.

**제외:** 라이브 데이터 갱신 (`worldfootballR_data` 업스트림에 의존), 2023년 이후 이적, FBref Big-5 직전 시즌 스탯이 없는 비-Big-5 리그 출신 선수, 베스트 행선지 추천기, 웹 앱, 골키퍼, 공개 콘텐츠, 에이전트 측 검증, CI. 설계 문서의 "NOT in Scope" 섹션 참고.
