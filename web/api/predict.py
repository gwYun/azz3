"""Vercel Python serverless function — transfer-fee predictor.

Modes (mode dispatch on request body shape):

  POST /api/predict  body: {"features": {<feature>: <value>, ...}}
       → {predicted_fee_eur, top_3_perturbations, feature_set_hash}
       Strict: every model feature must be present, no unknown keys.

  POST /api/predict  body: {"compare": {"a": {<features>}, "b": {<features>}}}
       → {a: {predicted_fee_eur}, b: {predicted_fee_eur},
          deciding_group, group_swaps: [{group, fee_a_with_b_group, delta_eur}, ...]}

  GET  /api/predict
       → median-baseline prediction + top_3_perturbations (warm-up + first-paint).

Constraints:
  - Body cap 2KB (15 floats easily fit; larger requests are rejected).
  - 4xx errors return verbose messages (client needs them).
  - 500s log full traceback to stderr, return generic message to client.
  - Cold-start self-check asserts model + feature_order + feature_stats all
    present and hash-consistent. Fail fast at module load, not first request.
"""
from __future__ import annotations

import json
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import numpy as np
import xgboost as xgb

MODEL_DIR = Path(__file__).resolve().parent / "model"
MODEL_PATH = MODEL_DIR / "model.json"
FEATURES_PATH = MODEL_DIR / "feature_order.json"
STATS_PATH = MODEL_DIR / "feature_stats.json"

MAX_BODY_BYTES = 2048


def _load_artifacts() -> tuple[xgb.Booster, dict]:
    """Cold-start self-check: every artifact present, hashes match. Raises on
    any drift so a broken deploy fails immediately, not on first user request.
    """
    for p in (MODEL_PATH, FEATURES_PATH, STATS_PATH):
        if not p.exists():
            raise RuntimeError(f"missing artifact: {p.name}")

    feats = json.loads(FEATURES_PATH.read_text())
    stats = json.loads(STATS_PATH.read_text())

    if feats.get("feature_set_hash") != stats.get("feature_set_hash"):
        raise RuntimeError(
            f"feature_set_hash drift: feature_order={feats.get('feature_set_hash')!r} "
            f"stats={stats.get('feature_set_hash')!r}"
        )

    booster = xgb.Booster()
    booster.load_model(str(MODEL_PATH))

    return booster, {
        "features": feats["features"],
        "medians": {k: float(v) for k, v in feats["medians"].items()},
        "feature_stats": stats["feature_stats"],
        "feature_groups": stats["feature_groups"],
        "feature_set_hash": feats["feature_set_hash"],
    }


# Module-load self-check. Cold start fails here if anything is wrong.
_BOOSTER, _META = _load_artifacts()
_FEATURES: list[str] = _META["features"]
_MEDIANS: dict[str, float] = _META["medians"]
_STATS: dict[str, dict[str, float]] = _META["feature_stats"]
_GROUPS: dict[str, list[str]] = _META["feature_groups"]
_HASH: str = _META["feature_set_hash"]


class ValidationError(Exception):
    """4xx-class error with a client-safe message."""


def _vector_from_dict(d: dict, *, strict: bool) -> np.ndarray:
    """Validate + project a dict to the canonical feature vector.
    strict=True (POST predict/compare): reject missing or unknown keys.
    strict=False (GET baseline): fill missing with medians.
    """
    if not isinstance(d, dict):
        raise ValidationError("features must be a JSON object")

    if strict:
        missing = [f for f in _FEATURES if f not in d]
        if missing:
            raise ValidationError(f"missing required features: {missing}")
        unknown = [k for k in d if k not in _FEATURES]
        if unknown:
            raise ValidationError(f"unknown features: {unknown}")

    row = np.empty((1, len(_FEATURES)), dtype=np.float32)
    for i, feat in enumerate(_FEATURES):
        v = d.get(feat, _MEDIANS[feat])
        try:
            row[0, i] = float(v)
        except (TypeError, ValueError):
            raise ValidationError(f"feature {feat!r}: cannot coerce {v!r} to float")
    return row


def _predict_rows(rows: np.ndarray) -> np.ndarray:
    """One Booster.predict call for N rows; xgboost vectorizes internally.
    Model was trained on log1p(deflated_fee, baseline=2014); output is in
    2014-baseline euros. Apply a season-specific inflate factor externally
    if nominal euros for a specific transfer year are needed.
    """
    dmat = xgb.DMatrix(rows, feature_names=_FEATURES)
    return np.expm1(_BOOSTER.predict(dmat))


def _top_3_perturbations(base_row: np.ndarray, base_fee: float) -> list[dict]:
    """Build N perturbed rows (each = base + 1 SD on one feature, capped at P95),
    score them all in one call, return top-3 positive deltas.
    """
    perturbed_rows = []
    candidates: list[dict] = []
    for i, feat in enumerate(_FEATURES):
        sd = _STATS[feat]["sd"]
        p95 = _STATS[feat]["p95"]
        current = float(base_row[0, i])
        if sd <= 0:
            continue
        new_val = min(current + sd, p95)
        if new_val <= current + 1e-9:
            # Already at or above ceiling — no positive perturbation possible.
            continue
        perturbed = base_row.copy()
        perturbed[0, i] = new_val
        perturbed_rows.append(perturbed[0])
        candidates.append({"feature": feat, "new_value": new_val, "current": current})

    if not perturbed_rows:
        return []

    rows = np.vstack(perturbed_rows)
    fees = _predict_rows(rows)
    for c, f in zip(candidates, fees):
        c["predicted_fee_eur"] = float(f)
        c["delta_eur"] = float(f - base_fee)

    positive = [c for c in candidates if c["delta_eur"] > 0]
    positive.sort(key=lambda c: c["delta_eur"], reverse=True)
    return positive[:3]


def _predict_with_counterfactuals(features: dict, *, strict: bool = True) -> dict:
    base_row = _vector_from_dict(features, strict=strict)
    base_fee = float(_predict_rows(base_row)[0])
    top3 = _top_3_perturbations(base_row, base_fee)
    return {
        "predicted_fee_eur": base_fee,
        "top_3_perturbations": top3,
        "feature_set_hash": _HASH,
    }


def _predict_compare(payload: dict) -> dict:
    """Group-swap deciding-group analysis. For each correlated-feature group,
    predict the fee if A swapped that group's values for B's. Group with the
    largest |fee shift| is the deciding group.
    """
    if not isinstance(payload, dict) or "a" not in payload or "b" not in payload:
        raise ValidationError("compare: body must be {'compare': {'a': {...}, 'b': {...}}}")
    row_a = _vector_from_dict(payload["a"], strict=True)
    row_b = _vector_from_dict(payload["b"], strict=True)

    # Baseline predictions for both.
    base_fees = _predict_rows(np.vstack([row_a[0], row_b[0]]))
    fee_a = float(base_fees[0])
    fee_b = float(base_fees[1])

    # Build N group-swap rows: A with group_g members replaced by B's values.
    swap_rows = []
    swaps: list[dict] = []
    for group_name, members in _GROUPS.items():
        swap = row_a.copy()
        for feat in members:
            idx = _FEATURES.index(feat)
            swap[0, idx] = row_b[0, idx]
        swap_rows.append(swap[0])
        swaps.append({"group": group_name, "members": members})

    if not swap_rows:
        return {"a": {"predicted_fee_eur": fee_a}, "b": {"predicted_fee_eur": fee_b},
                "deciding_group": None, "group_swaps": []}

    swap_fees = _predict_rows(np.vstack(swap_rows))
    for s, f in zip(swaps, swap_fees):
        s["fee_a_with_b_group_eur"] = float(f)
        s["delta_eur"] = float(f - fee_a)
        s["abs_delta_eur"] = abs(s["delta_eur"])

    swaps.sort(key=lambda s: s["abs_delta_eur"], reverse=True)
    deciding = swaps[0]["group"] if swaps else None

    return {
        "a": {"predicted_fee_eur": fee_a},
        "b": {"predicted_fee_eur": fee_b},
        "deciding_group": deciding,
        "group_swaps": swaps,
        "feature_set_hash": _HASH,
    }


def _dispatch(body: dict) -> dict:
    if "features" in body:
        return _predict_with_counterfactuals(body["features"], strict=True)
    if "compare" in body:
        return _predict_compare(body["compare"])
    raise ValidationError("body must contain either 'features' or 'compare'")


class handler(BaseHTTPRequestHandler):  # noqa: N801 — Vercel requires lowercase `handler`
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_500(self, exc: Exception) -> None:
        traceback.print_exception(exc, file=sys.stderr)
        self._send(500, {"error": "internal error"})

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        try:
            result = _predict_with_counterfactuals({}, strict=False)
            self._send(200, result)
        except Exception as exc:  # noqa: BLE001
            self._send_500(exc)

    def do_POST(self) -> None:  # noqa: N802 — stdlib API
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY_BYTES:
                self._send(400, {"error": f"request body exceeds {MAX_BODY_BYTES} bytes"})
                return
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            body = json.loads(raw) if raw else {}
            if not isinstance(body, dict):
                self._send(400, {"error": "body must be a JSON object"})
                return
            result = _dispatch(body)
            self._send(200, result)
        except json.JSONDecodeError as exc:
            self._send(400, {"error": f"invalid JSON: {exc}"})
        except ValidationError as exc:
            self._send(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._send_500(exc)
