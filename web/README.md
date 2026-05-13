# azz3 web — transfer-fee predictor playground

Next.js + Vercel Python serverless. Drag sliders for football stats, see the predicted transfer fee update, save builds, share them, compare two side-by-side.

Audience: 5 teammates. Desktop-first. English + Korean UI toggle.

## Layout

```
web/
  api/
    predict.py            # Vercel serverless function (mode dispatch: features | compare)
    model/
      model.json          # xgboost native format (~640 KB)
      feature_order.json  # ordered features + medians + feature_set_hash
      feature_stats.json  # P5/P95/SD per feature + correlated-feature groups
  app/                    # Next.js App Router (Glossary, Build-a-Player, Saved+Compare)
  public/
    model-info.json       # frontend mirror of feature_stats — CDN-served
    archetypes.json       # six fake-player presets
  package.json
  vercel.json
```

`feature_set_hash` ties everything together: any change to features, model
weights, or stats produces a new hash. Frontend stamps it on every saved
build; mismatch puts the build in read-only mode (saved against an older
model).

## Local sanity check (no Vercel needed)

```bash
.venv/bin/python -c "
import sys; sys.path.insert(0, 'web/api')
from predict import _predict_with_counterfactuals, _FEATURES, _MEDIANS
print(_predict_with_counterfactuals({}, strict=False))   # GET baseline
print(_predict_with_counterfactuals({f: _MEDIANS[f] for f in _FEATURES}))  # POST
"
```

## Deploy

Vercel deploys automatically on push to `main` via the Vercel ↔ GitHub
integration (project linked locally via `web/.vercel/project.json`).
For a manual deploy from a laptop:

```bash
cd web/
yarn dlx vercel@latest --prod
```

## Re-export the model after retraining

```bash
.venv/bin/python scripts/export_for_web.py
git add web/api/model/ web/public/
git commit -m "chore: refresh web model artifact"
git push
```

The export script is the only writer of `web/api/model/*` and
`web/public/model-info.json + archetypes.json`. Don't hand-edit those files;
re-run the script.

## Bundle size

Function bundle uses `xgboost-cpu` (CPU-only, ~10× smaller than the default
`xgboost` wheel which bundles CUDA). Without it the bundle blows past the
500 MB Lambda ephemeral storage limit.
