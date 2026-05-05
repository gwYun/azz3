"""Export the trained model in the form the Vercel serverless function needs.

Reads:
  data/models/xgb_transfer_fee.pkl     (pickled XGBRegressor, sklearn wrapper)
  data/models/selected_features.json   (feature order + medians)

Writes:
  web/api/model/model.json             (xgboost native format, no pickle, ~600KB)
  web/api/model/feature_order.json     (ordered feature list + median fallbacks)

The native xgboost JSON format is portable across xgboost versions and avoids
pickle compatibility risk on the serverless side. The Booster.predict() path
needs only xgboost + numpy at runtime — no sklearn, no pandas, no shap.
"""
from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import config  # noqa: E402

MODEL_PKL = config.MODELS_DIR / "xgb_transfer_fee.pkl"
FEATS_JSON = config.MODELS_DIR / "selected_features.json"

WEB_MODEL_DIR = ROOT / "web" / "api" / "model"
WEB_MODEL_DIR.mkdir(parents=True, exist_ok=True)
OUT_MODEL = WEB_MODEL_DIR / "model.json"
OUT_FEATURES = WEB_MODEL_DIR / "feature_order.json"


def main() -> None:
    if not MODEL_PKL.exists():
        raise SystemExit(f"missing {MODEL_PKL} — run scripts/train.py first")
    if not FEATS_JSON.exists():
        raise SystemExit(f"missing {FEATS_JSON} — run scripts/train.py first")

    with open(MODEL_PKL, "rb") as f:
        sk_model = pickle.load(f)

    booster = sk_model.get_booster()
    booster.save_model(str(OUT_MODEL))

    feats = json.loads(FEATS_JSON.read_text())
    payload = {
        "features": feats["features"],
        "medians": feats["medians"],
    }
    OUT_FEATURES.write_text(json.dumps(payload, indent=2))

    print(f"wrote {OUT_MODEL} ({OUT_MODEL.stat().st_size} bytes)")
    print(f"wrote {OUT_FEATURES} ({len(payload['features'])} features)")


if __name__ == "__main__":
    main()
