# azz3 web — 이적료 예측기 플레이그라운드

Next.js + Vercel Python 서버리스. 축구 스탯 슬라이더를 드래그하면 예측 이적료가 갱신되고, 빌드를 저장·공유하고, 두 빌드를 나란히 비교할 수 있음.

대상: 팀원 5명. 데스크탑 우선. 영어 + 한국어 UI 토글.

## 레이아웃

```
web/
  api/
    predict.py            # Vercel 서버리스 함수 (모드 디스패치: features | compare)
    model/
      model.json          # xgboost 네이티브 포맷 (약 640 KB)
      feature_order.json  # 순서가 정해진 특성 + 중앙값 + feature_set_hash
      feature_stats.json  # 특성별 P5/P95/SD + 상관 특성 그룹
  app/                    # Next.js App Router (Glossary, Build-a-Player, Saved+Compare)
  public/
    model-info.json       # 프론트엔드용 feature_stats 미러 — CDN 서빙
    archetypes.json       # 가상 선수 프리셋 6개
  package.json
  vercel.json
```

`feature_set_hash`가 모든 것을 묶음: 특성, 모델 가중치, 스탯 중 하나라도 바뀌면 새 해시가 생성됨. 프론트엔드는 저장된 모든 빌드에 이 해시를 스탬프함; 불일치 시 빌드는 read-only 모드로 전환됨 (구 모델 기준으로 저장된 빌드).

## 로컬 sanity check (Vercel 불필요)

```bash
.venv/bin/python -c "
import sys; sys.path.insert(0, 'web/api')
from predict import _predict_with_counterfactuals, _FEATURES, _MEDIANS
print(_predict_with_counterfactuals({}, strict=False))   # GET 베이스라인
print(_predict_with_counterfactuals({f: _MEDIANS[f] for f in _FEATURES}))  # POST
"
```

## 배포

Vercel ↔ GitHub 통합을 통해 `main` 푸시 시 Vercel이 자동 배포 (프로젝트는 `web/.vercel/project.json`을 통해 로컬에 연결됨). 노트북에서 수동 배포가 필요할 때:

```bash
cd web/
yarn dlx vercel@latest --prod
```

## 재학습 후 모델 재내보내기

```bash
.venv/bin/python scripts/export_for_web.py
git add web/api/model/ web/public/
git commit -m "chore: refresh web model artifact"
git push
```

이 export 스크립트가 `web/api/model/*`와 `web/public/model-info.json + archetypes.json`을 갱신하는 유일한 통로임. 해당 파일들을 수동 편집하지 말고 스크립트를 다시 실행할 것.

## 번들 사이즈

함수 번들은 `xgboost-cpu` (CPU 전용, CUDA를 번들링하는 기본 `xgboost` 휠보다 약 10배 작음)를 사용. 이게 없으면 번들이 Lambda 임시 스토리지 한도 500 MB를 초과함.
