"""Generate predictions and write CSVs to predictions/.

Each run writes to predictions/runs/{UTC-timestamp}/ AND mirrors the
files into predictions/latest/. Every row in every CSV carries `run_id`
(UTC ISO datetime) and `model_commit` (git short SHA at run time).

Three outputs per run:
  1. test_set.csv — held-out test set with actual, predicted, residual,
     and top-3 stat-improvement targets (SHAP).
  2. sample_top.csv — the 10 highest-fee test transfers.
  3. fake_player.csv (+ fake_player_input_stats.csv) — synthetic profile
     predictions and SHAP top-3.

Also writes predictions/runs/runs.jsonl — one JSON line per run with
metadata (run_id, commit, n_train, n_test, mae, spearman).

This script mirrors scripts/train.py's data prep + feature engineering
pipeline exactly so predictions match the training-time distribution.
"""
from __future__ import annotations

import json
import logging
import pickle
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("predict")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src import config  # noqa: E402
from src.enrich import FeeDeflator, FrequencyEncoders  # noqa: E402
from src.shap_utils import top_k_stat_improvements  # noqa: E402

# Re-use train's data-prep so the pipeline stays in lockstep.
from scripts.train import prepare_dataset  # noqa: E402

PREDICTIONS_DIR = config.PROJECT_ROOT / "predictions"
RUNS_DIR = PREDICTIONS_DIR / "runs"
LATEST_DIR = PREDICTIONS_DIR / "latest"
RUNS_DIR.mkdir(parents=True, exist_ok=True)
LATEST_DIR.mkdir(parents=True, exist_ok=True)


def _run_metadata() -> tuple[str, str]:
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=config.PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        sha = ""
    return run_id, sha


def _stamp_df(df: pd.DataFrame, run_id: str, model_commit: str) -> pd.DataFrame:
    out = df.copy()
    out.insert(0, "run_id", run_id)
    out.insert(1, "model_commit", model_commit)
    return out


def _write_csv_pair(df: pd.DataFrame, name: str, run_dir: Path) -> tuple[Path, Path]:
    run_path = run_dir / name
    latest_path = LATEST_DIR / name
    df.to_csv(run_path, index=False)
    shutil.copyfile(run_path, latest_path)
    return run_path, latest_path


def _eur(x: float) -> str:
    if x is None or pd.isna(x):
        return "—"
    if abs(x) >= 1e6:
        return f"€{x/1e6:,.1f}M"
    if abs(x) >= 1e3:
        return f"€{x/1e3:,.0f}k"
    return f"€{x:,.0f}"


@dataclass
class Artifacts:
    model: object
    features: list[str]                  # xgb-safe feature names (post-rename)
    rename_map: dict[str, str]           # original -> xgb-safe
    inverse_rename: dict[str, str]       # xgb-safe -> original
    medians: pd.Series                   # keyed by ORIGINAL feature names
    stds: pd.Series                      # keyed by XGB-SAFE feature names
    freq_encoders: FrequencyEncoders
    deflator: FeeDeflator
    target_transform: str                # "log1p_deflated" | "deflated" | "nominal"


def _load_artifacts() -> Artifacts:
    model_path = config.MODELS_DIR / "xgb_transfer_fee.pkl"
    feats_path = config.MODELS_DIR / "selected_features.json"
    if not model_path.exists() or not feats_path.exists():
        sys.exit("Run scripts/train.py first to produce model artifacts.")
    with open(model_path, "rb") as f:
        model = pickle.load(f)
    with open(feats_path) as f:
        meta = json.load(f)
    rename_map = meta.get("rename_map", {})
    inverse = {v: k for k, v in rename_map.items()}
    return Artifacts(
        model=model,
        features=meta["features"],
        rename_map=rename_map,
        inverse_rename=inverse,
        medians=pd.Series(meta["medians"]),
        stds=pd.Series(meta.get("stds", {})),
        freq_encoders=FrequencyEncoders.from_dict(meta.get("freq_encoders", {})),
        deflator=FeeDeflator.from_dict(meta["deflator"]),
        target_transform=meta.get("target_transform", "nominal"),
    )


def _inflate_predictions(art: Artifacts, raw_pred: np.ndarray, seasons: pd.Series) -> np.ndarray:
    """Inverse of the training target transform. Returns nominal EUR."""
    s_factor = seasons.astype(str).map(art.deflator.deflator).to_numpy()
    if art.target_transform == "log1p_deflated":
        return np.expm1(raw_pred) * s_factor
    if art.target_transform == "deflated":
        return raw_pred * s_factor
    return raw_pred


class _NominalPredictor:
    """Wraps the trained model so .predict(X) returns nominal-EUR fees.

    SHAP-style ±1 SD perturbation works on this object because it has a
    .predict that matches what humans want to see (€). All perturbations
    use the constructor's `season` for the inflation factor — that's the
    right thing when you perturb a single player's stats.
    """

    def __init__(self, art: Artifacts, season: str):
        self.art = art
        self.season = str(season)
        self.factor = float(art.deflator.deflator.get(self.season, 1.0))

    def predict(self, X):
        raw = np.asarray(self.art.model.predict(X)).astype(float)
        if self.art.target_transform == "log1p_deflated":
            return np.expm1(raw) * self.factor
        if self.art.target_transform == "deflated":
            return raw * self.factor
        return raw


def _prepare_feature_frame(art: Artifacts, df: pd.DataFrame) -> pd.DataFrame:
    """Apply frequency encoders, rename for xgb safety, fill NaNs with training medians."""
    encoded = art.freq_encoders.transform(df)
    inv = art.inverse_rename or {f: f for f in art.features}
    # Build a frame keyed by original feature names first (so medians match).
    cols_original = [inv.get(f, f) for f in art.features]
    out = pd.DataFrame(index=encoded.index)
    for orig, xgb_name in zip(cols_original, art.features):
        if orig in encoded.columns:
            out[xgb_name] = pd.to_numeric(encoded[orig], errors="coerce")
        else:
            out[xgb_name] = np.nan
    # Median fill — medians are keyed by ORIGINAL names; map onto xgb-safe.
    fill = {xgb: float(art.medians.get(orig, 0.0))
            for orig, xgb in zip(cols_original, art.features)}
    out = out.fillna(value=fill).fillna(0.0)
    return out


def predict_test_set(art: Artifacts, joined: pd.DataFrame) -> pd.DataFrame:
    test_seasons = {"2021", "2022"}
    test_df = joined[joined["season"].astype(str).isin(test_seasons)].copy().reset_index(drop=True)

    X = _prepare_feature_frame(art, test_df)
    raw = np.asarray(art.model.predict(X)).astype(float)
    preds = _inflate_predictions(art, raw, test_df["season"])

    out = pd.DataFrame({
        "season": test_df["season"].astype(str),
        "player_name": test_df["player_name"],
        "from_club": test_df["club_2"],
        "to_club": test_df["team_name"],
        "position": test_df.get("player_position", pd.Series([""] * len(test_df))),
        "age": test_df.get("player_age", pd.Series([np.nan] * len(test_df))),
        "actual_fee_eur": test_df["transfer_fee"].astype(float),
        "predicted_fee_eur": preds.astype(float),
    })
    out["residual_eur"] = out["actual_fee_eur"] - out["predicted_fee_eur"]
    out["abs_pct_error"] = (out["residual_eur"].abs() / out["actual_fee_eur"]).round(3)

    # SHAP top-3 per player on NOMINAL EUR (predictor wrapper inverts the transform).
    # Use training-time stds (more stable than test-set stds and matches what the
    # model "saw" during fit).
    feat_stds = art.stds.reindex(art.features).fillna(1.0)
    log.info("Computing SHAP top-3 for %d test rows...", len(test_df))
    top3_strs = []
    for i, row in X.iterrows():
        season = str(test_df.iloc[i]["season"])
        nominal_model = _NominalPredictor(art, season)
        top3 = top_k_stat_improvements(nominal_model, row, art.features, feat_stds, k=3)
        top3_strs.append(_format_top3(top3, art.inverse_rename))
    out["top3_stat_improvements"] = top3_strs

    return out.sort_values("actual_fee_eur", ascending=False).reset_index(drop=True)


def _format_top3(top3, inverse_rename: dict[str, str]) -> str:
    return " | ".join(
        f"{s.direction}{inverse_rename.get(s.feature, s.feature)}:+€{s.delta_eur/1e6:.2f}M"
        for s in top3
    )


def make_fake_players() -> list[dict]:
    """Six archetypes. Stats now include FBref Standard + new engineered fields
    so the enriched model gets a complete row. Anything missing falls to the
    training-median fill.
    """
    # Engineered fields keyed by their POST-rename (xgb-safe) names match
    # whatever rename_map produced; we set them by ORIGINAL name and the
    # _prepare_feature_frame_for_fakes function below maps it.
    def base(age: int, market_value_m: float, contract_yrs: int, tenure_yrs: int, pos_group: str):
        d = {
            "age_years": age,
            "age_sq": age * age,
            "peak_distance": abs(age - 26),
            "prior_market_value_eur": market_value_m * 1e6,
            "contract_years_remaining": contract_yrs,
            "tenure_at_selling_club_years": tenure_yrs,
            "pos_forward": int(pos_group == "forward"),
            "pos_midfielder": int(pos_group == "midfielder"),
            "pos_defender": int(pos_group == "defender"),
            # Default categoricals for fakes (avoidance: model gets median fill for unset).
            "window_winter": 0,
            "nat_is_english": 0,
            "nat_is_eu": 1,
        }
        return d

    return [
        {
            "name": "브레이크아웃 라이트 윙어, 23세",
            "position": "Right Winger",
            "age": 23,
            "stats": {
                "MP_Playing": 32, "Starts_Playing": 28, "Min_Playing": 2520, "Mins_Per_90_Playing": 28.0,
                "Gls": 9, "Ast": 6, "G_minus_PK": 9, "PK": 0, "PKatt": 0, "CrdY": 4, "CrdR": 0,
                "Gls_Per": 0.32, "Ast_Per": 0.21, "G+A_Per": 0.54,
                "G_minus_PK_Per": 0.32, "G+A_minus_PK_Per": 0.54,
                "xG_Expected": 7.8, "npxG_Expected": 7.8, "xAG_Expected": 5.2, "npxG+xAG_Expected": 13.0,
                "xG_Per": 0.28, "xAG_Per": 0.19, "xG+xAG_Per": 0.47,
                "npxG_Per": 0.28, "npxG+xAG_Per": 0.47,
                **base(23, 25, 3, 2, "forward"),
            },
        },
        {
            "name": "베테랑 스트라이커, 31세",
            "position": "Centre-Forward",
            "age": 31,
            "stats": {
                "MP_Playing": 30, "Starts_Playing": 26, "Min_Playing": 2300, "Mins_Per_90_Playing": 25.6,
                "Gls": 18, "Ast": 3, "G_minus_PK": 16, "PK": 2, "PKatt": 3, "CrdY": 3, "CrdR": 0,
                "Gls_Per": 0.70, "Ast_Per": 0.12, "G+A_Per": 0.82,
                "G_minus_PK_Per": 0.62, "G+A_minus_PK_Per": 0.74,
                "xG_Expected": 16.2, "npxG_Expected": 13.9, "xAG_Expected": 2.1, "npxG+xAG_Expected": 16.0,
                "xG_Per": 0.63, "xAG_Per": 0.08, "xG+xAG_Per": 0.71,
                "npxG_Per": 0.54, "npxG+xAG_Per": 0.62,
                **base(31, 30, 2, 4, "forward"),
            },
        },
        {
            "name": "플레이메이킹 미드필더, 28세",
            "position": "Attacking Midfielder",
            "age": 28,
            "stats": {
                "MP_Playing": 35, "Starts_Playing": 33, "Min_Playing": 2970, "Mins_Per_90_Playing": 33.0,
                "Gls": 6, "Ast": 13, "G_minus_PK": 5, "PK": 1, "PKatt": 1, "CrdY": 5, "CrdR": 0,
                "Gls_Per": 0.18, "Ast_Per": 0.39, "G+A_Per": 0.57,
                "G_minus_PK_Per": 0.15, "G+A_minus_PK_Per": 0.55,
                "xG_Expected": 5.5, "npxG_Expected": 4.7, "xAG_Expected": 9.8, "npxG+xAG_Expected": 14.5,
                "xG_Per": 0.17, "xAG_Per": 0.30, "xG+xAG_Per": 0.47,
                "npxG_Per": 0.14, "npxG+xAG_Per": 0.44,
                **base(28, 45, 3, 3, "midfielder"),
            },
        },
        {
            "name": "수비형 미드필더, 26세",
            "position": "Defensive Midfielder",
            "age": 26,
            "stats": {
                "MP_Playing": 33, "Starts_Playing": 31, "Min_Playing": 2790, "Mins_Per_90_Playing": 31.0,
                "Gls": 1, "Ast": 2, "G_minus_PK": 1, "PK": 0, "PKatt": 0, "CrdY": 9, "CrdR": 1,
                "Gls_Per": 0.03, "Ast_Per": 0.06, "G+A_Per": 0.10,
                "G_minus_PK_Per": 0.03, "G+A_minus_PK_Per": 0.10,
                "xG_Expected": 0.9, "npxG_Expected": 0.9, "xAG_Expected": 1.6, "npxG+xAG_Expected": 2.5,
                "xG_Per": 0.03, "xAG_Per": 0.05, "xG+xAG_Per": 0.08,
                "npxG_Per": 0.03, "npxG+xAG_Per": 0.08,
                **base(26, 22, 4, 5, "midfielder"),
            },
        },
        {
            "name": "센터백, 27세",
            "position": "Centre-Back",
            "age": 27,
            "stats": {
                "MP_Playing": 34, "Starts_Playing": 33, "Min_Playing": 2970, "Mins_Per_90_Playing": 33.0,
                "Gls": 2, "Ast": 1, "G_minus_PK": 2, "PK": 0, "PKatt": 0, "CrdY": 6, "CrdR": 1,
                "Gls_Per": 0.06, "Ast_Per": 0.03, "G+A_Per": 0.09,
                "G_minus_PK_Per": 0.06, "G+A_minus_PK_Per": 0.09,
                "xG_Expected": 1.5, "npxG_Expected": 1.5, "xAG_Expected": 0.6, "npxG+xAG_Expected": 2.1,
                "xG_Per": 0.05, "xAG_Per": 0.02, "xG+xAG_Per": 0.07,
                "npxG_Per": 0.05, "npxG+xAG_Per": 0.07,
                **base(27, 30, 4, 4, "defender"),
            },
        },
        {
            "name": "복권형 원더키드, 18세",
            "position": "Left Winger",
            "age": 18,
            "stats": {
                "MP_Playing": 22, "Starts_Playing": 14, "Min_Playing": 1300, "Mins_Per_90_Playing": 14.4,
                "Gls": 5, "Ast": 4, "G_minus_PK": 5, "PK": 0, "PKatt": 0, "CrdY": 2, "CrdR": 0,
                "Gls_Per": 0.35, "Ast_Per": 0.28, "G+A_Per": 0.62,
                "G_minus_PK_Per": 0.35, "G+A_minus_PK_Per": 0.62,
                "xG_Expected": 4.0, "npxG_Expected": 4.0, "xAG_Expected": 3.2, "npxG+xAG_Expected": 7.2,
                "xG_Per": 0.28, "xAG_Per": 0.22, "xG+xAG_Per": 0.50,
                "npxG_Per": 0.28, "npxG+xAG_Per": 0.50,
                **base(18, 15, 4, 1, "forward"),
            },
        },
    ]


def _fake_to_xgb_row(art: Artifacts, fake_stats: dict) -> pd.Series:
    """Convert a fake-player stats dict into a row keyed by xgb-safe feature names,
    filled from training medians where the fake didn't specify a value.
    """
    inv = art.inverse_rename or {f: f for f in art.features}
    row = {}
    for f in art.features:
        orig = inv.get(f, f)
        if orig in fake_stats:
            row[f] = fake_stats[orig]
        else:
            row[f] = float(art.medians.get(orig, 0.0))
    return pd.Series(row)


def predict_fake_players(art: Artifacts) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    fakes = make_fake_players()
    # Use 2022 as the inflation reference season for fake-player nominal EUR.
    fake_season = "2022"
    nominal_model = _NominalPredictor(art, fake_season)

    # Use training-time stds for perturbation (clamped to a sensible floor).
    feat_stds = art.stds.reindex(art.features).fillna(1.0)

    pred_rows = []
    stats_rows = []
    for fake in fakes:
        row = _fake_to_xgb_row(art, fake["stats"])
        X = pd.DataFrame([row[art.features].values], columns=art.features)
        pred = float(nominal_model.predict(X)[0])
        top3 = top_k_stat_improvements(nominal_model, row, art.features, feat_stds, k=3)
        pred_rows.append({
            "name": fake["name"],
            "position": fake["position"],
            "age": fake["age"],
            "predicted_fee_eur": pred,
            "predicted_fee_eur_human": f"€{pred/1e6:.1f}M",
            "top3_stat_improvements": _format_top3(top3, art.inverse_rename),
        })
        stats_rows.append({"name": fake["name"], **fake["stats"]})
    return pd.DataFrame(pred_rows), pd.DataFrame(stats_rows), fakes


def _format_cell(src: str, v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "—"
    if isinstance(v, float):
        if "fee" in src or "delta" in src:
            return _eur(v)
        if "pct" in src or "_per" in src:
            return f"{v:.0f}%"
        return f"{v:.3f}"
    s = str(v)
    return s.replace("|", "\\|")


def _markdown_table(df: pd.DataFrame, columns: list[tuple[str, str]]) -> str:
    headers = [label for _, label in columns]
    sep = ["---"] * len(columns)
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(sep) + " |"]
    for _, row in df.iterrows():
        cells = [_format_cell(src, row.get(src, "")) for src, _ in columns]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def write_report_md(
    run_dir: Path,
    run_id: str,
    model_commit: str,
    test_preds: pd.DataFrame,
    fake_df: pd.DataFrame,
    fakes_raw: list[dict],
    audit: dict,
) -> tuple[Path, Path]:
    overall_mae = audit["test_mae_eur"]
    spearman = audit["test_spearman"]

    test_view = test_preds.copy()
    test_view["abs_err_eur"] = (test_view["actual_fee_eur"] - test_view["predicted_fee_eur"]).abs()
    test_view["err_pct"] = (test_view["abs_err_eur"] / test_view["actual_fee_eur"]) * 100

    top10 = test_view.head(10)
    best5 = test_view.sort_values("err_pct").head(5)
    worst5 = test_view.sort_values("err_pct", ascending=False).head(5)

    table_cols = [
        ("season", "시즌"),
        ("player_name", "선수"),
        ("to_club", "행선지"),
        ("actual_fee_eur", "실제"),
        ("predicted_fee_eur", "예측"),
        ("err_pct", "오차 %"),
        ("top3_stat_improvements", "Top-3 스탯 개선안 (Δ 예측 이적료)"),
    ]
    fake_table_cols = [
        ("name", "프로필"),
        ("position", "포지션"),
        ("age", "나이"),
        ("predicted_fee_eur", "예측 이적료"),
        ("top3_stat_improvements", "Top-3 스탯 개선안 (Δ 예측 이적료)"),
    ]
    fake_table_md = _markdown_table(fake_df, fake_table_cols)

    fake_details_blocks: list[str] = []
    for fake in fakes_raw:
        stat_lines = "\n".join(f"  - **{k}:** {v}" for k, v in fake["stats"].items())
        fake_details_blocks.append(
            f"<details><summary><b>{fake['name']}</b> &mdash; {fake['position']}, {fake['age']}세 &mdash; 입력 스탯</summary>\n\n{stat_lines}\n\n</details>"
        )
    fake_details_md = "\n\n".join(fake_details_blocks)

    md = f"""# 예측 리포트 — `{run_id}`

> 이 리포트가 처음이라면 **[docs/report-guide.md](../../../docs/report-guide.md)** 참조.

| 필드 | 값 |
| --- | --- |
| Run ID (UTC) | `{run_id}` |
| Model commit | `{model_commit or '(no-git)'}` |
| 모델 | 이적료(EUR)에 대한 xgboost 회귀기 (log-deflated 타깃) |
| 학습 행 수 | {audit['n_train']} |
| 테스트 행 수 | {audit['n_test']} |
| Test MAE | **{_eur(overall_mae)}** |
| Test Spearman ρ | **{spearman:.3f}** |

## 가장 비싼 홀드아웃 이적 Top 10

{_markdown_table(top10, table_cols)}

## 가장 잘 맞춘 예측 5개 (가장 낮은 %오차)

{_markdown_table(best5, table_cols)}

## 가장 못 맞춘 예측 5개 (가장 높은 %오차)

{_markdown_table(worst5, table_cols)}

## 가상 선수 (2022 시즌 기준 인플레이션 반영)

{fake_table_md}

### 아키타입별 입력 스탯

{fake_details_md}

---

*`scripts/predict.py`에 의해 생성됨. 같은 디렉토리와 `predictions/latest/`에 CSV 동등본 있음. 감사 추적: `predictions/runs/runs.jsonl`.*
"""
    run_md = run_dir / "report.md"
    latest_md = LATEST_DIR / "report.md"
    run_md.write_text(md)
    latest_md.write_text(md)
    return run_md, latest_md


def main() -> int:
    art = _load_artifacts()
    run_id, model_commit = _run_metadata()
    run_dir = RUNS_DIR / run_id.replace(":", "")
    run_dir.mkdir(parents=True, exist_ok=True)
    log.info("Run %s | commit %s | dir %s", run_id, model_commit or "(no-git)", run_dir)

    joined = prepare_dataset()

    log.info("Predicting on full held-out test set...")
    test_preds = _stamp_df(predict_test_set(art, joined), run_id, model_commit)
    run_path, latest_path = _write_csv_pair(test_preds, "test_set.csv", run_dir)
    log.info("Wrote %s + %s (%d rows)", run_path, latest_path, len(test_preds))

    sample = test_preds.head(10).copy()
    _write_csv_pair(sample, "sample_top.csv", run_dir)

    log.info("Predicting on synthetic fake players (6 archetypes)...")
    fake_df, fake_stats_df, fakes_raw = predict_fake_players(art)
    fake_df = _stamp_df(fake_df, run_id, model_commit)
    fake_stats_df = _stamp_df(fake_stats_df, run_id, model_commit)
    _write_csv_pair(fake_df, "fake_players.csv", run_dir)
    _write_csv_pair(fake_stats_df, "fake_players_input_stats.csv", run_dir)

    train_seasons = {str(s) for s in range(2014, 2021)}
    n_train = int((joined["season"].astype(str).isin(train_seasons)).sum())
    n_test = len(test_preds)
    overall_mae = float((test_preds["actual_fee_eur"] - test_preds["predicted_fee_eur"]).abs().mean())
    spearman = float(test_preds["actual_fee_eur"].corr(test_preds["predicted_fee_eur"], method="spearman"))
    audit = {
        "run_id": run_id,
        "model_commit": model_commit,
        "model_path": str(config.MODELS_DIR / "xgb_transfer_fee.pkl"),
        "n_train": n_train,
        "n_test": n_test,
        "test_mae_eur": overall_mae,
        "test_spearman": spearman,
        "fake_players": [
            {"name": r["name"], "predicted_eur": float(r["predicted_fee_eur"])}
            for _, r in fake_df.iterrows()
        ],
        "run_dir": str(run_dir.relative_to(config.PROJECT_ROOT)),
    }
    with open(RUNS_DIR / "runs.jsonl", "a") as f:
        f.write(json.dumps(audit) + "\n")

    run_md, latest_md = write_report_md(
        run_dir, run_id, model_commit, test_preds, fake_df, fakes_raw, audit
    )
    log.info("Wrote %s + %s", run_md, latest_md)

    print("\n" + "=" * 80)
    print("Top 10 — 홀드아웃 테스트 셋, 실제 vs 예측 이적료")
    print("=" * 80)
    pd.set_option("display.width", 220)
    pd.set_option("display.max_columns", 12)
    show = test_preds.head(10).copy()
    show["actual"] = (show["actual_fee_eur"] / 1e6).round(1).map(lambda x: f"€{x:>5.1f}M")
    show["predicted"] = (show["predicted_fee_eur"] / 1e6).round(1).map(lambda x: f"€{x:>5.1f}M")
    show["residual"] = (show["residual_eur"] / 1e6).round(1).map(lambda x: f"{x:+.1f}M")
    show["err%"] = (show["abs_pct_error"] * 100).round(0).astype(int).map(lambda x: f"{x}%")
    print(show[["season", "player_name", "to_club", "actual", "predicted", "residual", "err%", "top3_stat_improvements"]].to_string(index=False))

    print("\n" + "=" * 80)
    print("가상 선수 예측 (2022 기준)")
    print("=" * 80)
    print(fake_df[["name", "position", "age", "predicted_fee_eur_human", "top3_stat_improvements"]].to_string(index=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
