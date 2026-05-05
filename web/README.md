# azz3 web — Vercel deployment spike

Validates that the trained transfer-fee model fits and runs on Vercel Python serverless.

## Layout

```
web/
  api/
    predict.py            # serverless function — GET returns baseline, POST takes feature dict
    model/
      model.json          # xgboost native format, ~640 KB (committed; regenerate with scripts/export_for_web.py)
      feature_order.json  # ordered features + median fallbacks
  requirements.txt        # xgboost + numpy only — no pandas, no shap, no sklearn
  vercel.json             # pinned to yarn install; 30s timeout, 1 GB memory for the predict function
  package.json            # packageManager: yarn@4.5.1 (locks the package manager for Vercel and contributors)
  yarn.lock               # present so Vercel auto-detects yarn (do not delete or replace with package-lock.json)
```

## Local sanity check (no Vercel needed)

```bash
cd ..
.venv/bin/python -c "
import sys
sys.path.insert(0, 'web/api')
from predict import _predict
print(_predict({}))                    # baseline (all medians)
print(_predict({'Gls': 20, 'xG_Expected': 18, 'Ast': 8}))
"
```

## Deploy via GitHub Actions (canonical path)

Deploys are driven by `.github/workflows/deploy-web.yml`:

- Push to `main` touching `web/**` → production deploy.
- Pull request touching `web/**` → preview deploy. Vercel comments the preview URL on the PR.

The workflow uses **yarn** (pinned via `packageManager` in `package.json`), runs `vercel pull` + `vercel build` + `vercel deploy --prebuilt`, and smoke-tests the `/api/predict` endpoint after deploy.

### One-time setup

1. **Link the project to Vercel locally** so we can read the org/project IDs:
   ```bash
   cd web/
   yarn dlx vercel@latest link    # pick the team and project
   ```
   This creates `web/.vercel/project.json` (gitignored) containing `orgId` and `projectId`.

2. **Create a Vercel access token** at https://vercel.com/account/tokens → "Create Token". Scope it to your team. Copy the value.

3. **Add three secrets** to the GitHub repo (Settings → Secrets and variables → Actions → New repository secret):
   | Secret | Value |
   |---|---|
   | `VERCEL_TOKEN` | the token from step 2 |
   | `VERCEL_ORG_ID` | `orgId` from `web/.vercel/project.json` |
   | `VERCEL_PROJECT_ID` | `projectId` from `web/.vercel/project.json` |

4. **Commit and push.** The next push to `main` that changes anything under `web/` triggers a production deploy. Open a PR that changes a file under `web/` to verify preview deploys work.

### Read the secrets out of `.vercel/project.json`

```bash
cat web/.vercel/project.json
# {"orgId":"team_...","projectId":"prj_...",...}
```

### Manual deploy (escape hatch)

If GitHub Actions is broken or you need to ship from a laptop:

```bash
cd web/
yarn dlx vercel@latest --prod
```

This project uses **yarn** strictly. Do not use npm. If you don't have yarn:
`corepack enable && corepack prepare yarn@stable --activate` (or `brew install yarn` on macOS).

## Validate the spike answered its three questions

After the GitHub Actions deploy succeeds (the workflow already runs a smoke test, but you should verify cold-start latency and the response shape yourself):

1. **Did the bundle deploy?** If Vercel shows a green "Ready" status, you're under the 250 MB unzipped limit. If it errors with `Function size limit exceeded`, the design needs to switch to ONNX runtime or move the model off Vercel.
2. **Cold start latency.** First request after a deploy:
   ```bash
   time curl https://<your-project>.vercel.app/api/predict
   ```
   Expect 5-12s the first time. If it pushes past 30s (the configured timeout), increase memory in `vercel.json` (more memory = more CPU on Vercel) or switch to a warm-up ping strategy in the frontend.
3. **Returns a number.** Subsequent requests should be sub-second:
   ```bash
   curl -X POST https://<your-project>.vercel.app/api/predict \
     -H 'Content-Type: application/json' \
     -d '{"Gls": 18, "xG_Expected": 14.2, "Ast": 6, "xAG_Expected": 5.1}'
   ```
   Should return JSON with `predicted_fee_eur` set to a positive float.

## Re-export the model after retraining

```bash
.venv/bin/python scripts/export_for_web.py
git add web/api/model/
git commit -m "chore: refresh web model artifact"
git push                       # GitHub Actions auto-deploys on push to main
```

## Status

Spike scope only. No frontend, no top-3 counterfactuals, no schemaVersion handling, no error UI. Those land in subsequent steps once this spike confirms the bundle ships. See the design doc at `~/.gstack/projects/azz3/gwyunm1air-main-design-20260505-144914.md` for the full plan.
