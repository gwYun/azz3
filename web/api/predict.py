"""Vercel Python serverless function — transfer-fee predictor spike.

Goal of this spike: validate that xgboost + numpy fit under Vercel's 250MB
unzipped function size limit, deploy successfully, and return a prediction.
No SHAP, no pandas, no sklearn — just Booster.predict.

Endpoint:
  GET  /api/predict             — returns prediction for the median-feature
                                  baseline. Useful for a "does it work?" probe.

  POST /api/predict             — body: JSON object with feature values, e.g.
                                  {"Gls": 12, "xG_Expected": 10.5, ...}.
                                  Missing features are filled with the median
                                  fallback baked into feature_order.json.

Response:
  {
    "predicted_fee_eur": <float>,
    "feature_count": <int>,
    "missing_features_filled_with_median": [<feature names>]
  }

Design doc: ~/.gstack/projects/azz3/gwyunm1air-main-design-20260505-144914.md
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import numpy as np
import xgboost as xgb

MODEL_DIR = Path(__file__).resolve().parent / "model"
MODEL_PATH = MODEL_DIR / "model.json"
FEATURES_PATH = MODEL_DIR / "feature_order.json"

# Loaded once per cold start; reused across warm invocations.
_BOOSTER: xgb.Booster | None = None
_FEATURES: list[str] | None = None
_MEDIANS: dict[str, float] | None = None


def _load() -> tuple[xgb.Booster, list[str], dict[str, float]]:
    global _BOOSTER, _FEATURES, _MEDIANS
    if _BOOSTER is None:
        booster = xgb.Booster()
        booster.load_model(str(MODEL_PATH))
        meta = json.loads(FEATURES_PATH.read_text())
        _BOOSTER = booster
        _FEATURES = meta["features"]
        _MEDIANS = {k: float(v) for k, v in meta["medians"].items()}
    return _BOOSTER, _FEATURES, _MEDIANS  # type: ignore[return-value]


def _predict(user_input: dict) -> dict:
    booster, features, medians = _load()
    missing: list[str] = []
    row = np.empty((1, len(features)), dtype=np.float32)
    for i, feat in enumerate(features):
        if feat in user_input:
            row[0, i] = float(user_input[feat])
        else:
            row[0, i] = medians[feat]
            missing.append(feat)
    dmat = xgb.DMatrix(row, feature_names=features)
    fee = float(booster.predict(dmat)[0])
    return {
        "predicted_fee_eur": fee,
        "feature_count": len(features),
        "missing_features_filled_with_median": missing,
    }


class handler(BaseHTTPRequestHandler):  # noqa: N801 — Vercel requires lowercase `handler`
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        try:
            result = _predict({})
            self._send(200, result)
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802 — stdlib API
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            user_input = json.loads(raw) if raw else {}
            if not isinstance(user_input, dict):
                self._send(400, {"error": "body must be a JSON object"})
                return
            result = _predict(user_input)
            self._send(200, result)
        except json.JSONDecodeError as exc:
            self._send(400, {"error": f"invalid JSON: {exc}"})
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"error": str(exc)})
