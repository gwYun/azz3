"""Generate predictions and write CSVs to predictions/.

Each run writes to predictions/runs/{UTC-timestamp}/ AND mirrors the
files into predictions/latest/ so README links stay stable. Every row
in every CSV carries `run_id` (UTC ISO datetime) and `model_commit`
(git short SHA at run time) so trial dates and model versions are
traceable across runs.

Three outputs per run:
  1. test_set.csv — every row in the held-out test set with actual,
     predicted, residual, and top-3 stat-improvement targets.
  2. sample_top.csv — the 10 highest-fee test transfers (readable demo).
  3. fake_player.csv (+ fake_player_input_stats.csv) — synthetic profile
     prediction and SHAP top-3.

Also writes predictions/runs/runs.jsonl — one JSON line per run with
metadata (run_id, commit, n_train, n_test, mae, spearman). This is the
audit trail for "which model produced this prediction on what date."
"""
from __future__ import annotations

import json
import logging
import pickle
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("predict")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src import config  # noqa: E402
from src.data import (  # noqa: E402
    join_transfers_with_prior_season_stats,
    load_fbref_player_stats,
    load_transfers,
)
from src.shap_utils import top_k_stat_improvements  # noqa: E402

PREDICTIONS_DIR = config.PROJECT_ROOT / "predictions"
RUNS_DIR = PREDICTIONS_DIR / "runs"
LATEST_DIR = PREDICTIONS_DIR / "latest"
RUNS_DIR.mkdir(parents=True, exist_ok=True)
LATEST_DIR.mkdir(parents=True, exist_ok=True)


def _run_metadata() -> tuple[str, str]:
    """Return (run_id_iso_utc, git_short_sha). Empty SHA if not in a git repo."""
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
    """Prepend `run_id` and `model_commit` columns so every row is auditable."""
    out = df.copy()
    out.insert(0, "run_id", run_id)
    out.insert(1, "model_commit", model_commit)
    return out


def _write_csv_pair(df: pd.DataFrame, name: str, run_dir: Path) -> tuple[Path, Path]:
    """Write to runs/{ts}/{name} AND mirror to latest/{name}. Returns (run_path, latest_path)."""
    run_path = run_dir / name
    latest_path = LATEST_DIR / name
    df.to_csv(run_path, index=False)
    shutil.copyfile(run_path, latest_path)
    return run_path, latest_path


def _eur(x: float) -> str:
    """€12.3M / €450k formatted for tables."""
    if x is None or pd.isna(x):
        return "—"
    if abs(x) >= 1e6:
        return f"€{x/1e6:,.1f}M"
    if abs(x) >= 1e3:
        return f"€{x/1e3:,.0f}k"
    return f"€{x:,.0f}"


def _format_cell(src: str, v) -> str:
    """Format one DataFrame cell for a markdown table.

    - fee-like columns: use _eur(...)
    - err_pct: integer percent
    - other floats: 3-decimal
    - any string with a literal '|' is escaped so it doesn't break the table
    """
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
    """Render df as a GitHub-flavored markdown table.

    `columns` is a list of (df_column_name, header_label) so we can rename
    for the human-facing view without mutating the DataFrame.
    """
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
    """Compose a human-friendly markdown report for this run.

    Layout: header (run metadata), headline metrics, top-10 + best-5 + worst-5
    tables, multi-archetype fake player section. Mirrored to latest/report.md.
    """
    overall_mae = audit["test_mae_eur"]
    spearman = audit["test_spearman"]

    # Best / worst by absolute % error.
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

    # Build the fake-players summary table (one row per archetype).
    fake_table_cols = [
        ("name", "프로필"),
        ("position", "포지션"),
        ("age", "나이"),
        ("predicted_fee_eur", "예측 이적료"),
        ("top3_stat_improvements", "Top-3 스탯 개선안 (Δ 예측 이적료)"),
    ]
    fake_table_md = _markdown_table(fake_df, fake_table_cols)

    # Render the per-archetype input stats as collapsible <details> blocks.
    fake_details_blocks: list[str] = []
    for fake in fakes_raw:
        stat_lines = "\n".join(f"  - **{k}:** {v}" for k, v in fake["stats"].items())
        fake_details_blocks.append(
            f"<details><summary><b>{fake['name']}</b> &mdash; {fake['position']}, {fake['age']}세 &mdash; 입력 스탯</summary>\n\n{stat_lines}\n\n</details>"
        )
    fake_details_md = "\n\n".join(fake_details_blocks)

    md = f"""# 예측 리포트 — `{run_id}`

> 이 리포트가 처음이라면 **[docs/report-guide.md](../../../docs/report-guide.md)** 참조 —
> 모든 컬럼·스탯·SHAP 출력의 의미를 설명함.

| 필드 | 값 |
| --- | --- |
| Run ID (UTC) | `{run_id}` |
| Model commit | `{model_commit or '(no-git)'}` |
| 모델 | 이적료(EUR)에 대한 xgboost 회귀기 |
| 학습 행 수 | {audit['n_train']} |
| 테스트 행 수 | {audit['n_test']} |
| Test MAE | **{_eur(overall_mae)}** |
| Test Spearman ρ | **{spearman:.3f}** |

> Spearman ρ ≈ {spearman:.2f} → 모델이 약 {(0.5 + spearman/2)*100:.0f}%의 비율로 이적을
> 올바르게 랭킹한다는 의미 (랜덤 = 50%). 상대 랭킹 신호로 유용;
> 절대 예측은 엘리트급 이적을 과소평가하는 경향이 있음.

## 가장 비싼 홀드아웃 이적 Top 10

{_markdown_table(top10, table_cols)}

## 가장 잘 맞춘 예측 5개 (가장 낮은 %오차)

{_markdown_table(best5, table_cols)}

## 가장 못 맞춘 예측 5개 (가장 높은 %오차)

{_markdown_table(worst5, table_cols)}

## 가상 선수

서로 다른 포지션·나이·스탯 프로필을 가진 6개의 아키타입.
목적은 (a) 선수 타입 전반에서 모델 반응을 sanity-check, (b) 모델이 잘 보정된 곳과
그렇지 않은 곳(수비수는 알려진 약점)을 드러내기, (c) 아키타입별 SHAP "이 스탯을
개선하라" 출력을 보여주기.

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


def _load_artifacts():
    model_path = config.MODELS_DIR / "xgb_transfer_fee.pkl"
    feats_path = config.MODELS_DIR / "selected_features.json"
    if not model_path.exists() or not feats_path.exists():
        sys.exit("Run scripts/train.py first to produce model artifacts.")
    with open(model_path, "rb") as f:
        model = pickle.load(f)
    with open(feats_path) as f:
        meta = json.load(f)
    return model, meta["features"], pd.Series(meta["medians"])


def _format_top3(top3) -> str:
    """Compact one-cell representation of top-3 SHAP improvements."""
    return " | ".join(
        f"{s.direction}{s.feature}:+€{s.delta_eur/1e6:.2f}M" for s in top3
    )


def predict_test_set(model, features, medians, joined: pd.DataFrame, train_stds: pd.Series) -> pd.DataFrame:
    test_seasons = {"2021", "2022"}
    test_df = joined[joined["season"].astype(str).isin(test_seasons)].copy().reset_index(drop=True)
    test_df[features] = test_df[features].fillna(medians)

    X = test_df[features]
    preds = model.predict(X)

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

    # SHAP top-3 per player. Slow-ish (k * n_features predictions per row) but n=96 is fine.
    log.info("Computing SHAP top-3 for %d test rows...", len(test_df))
    top3_strs = []
    for _, row in test_df.iterrows():
        top3 = top_k_stat_improvements(model, row, features, train_stds, k=3)
        top3_strs.append(_format_top3(top3))
    out["top3_stat_improvements"] = top3_strs

    return out.sort_values("actual_fee_eur", ascending=False).reset_index(drop=True)


def make_fake_players() -> list[dict]:
    """A small roster of distinct archetypes covering different positions,
    ages, and stat profiles. Each entry is a complete `stats` dict matching
    the FBref standard-table feature set.
    """
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
            },
        },
    ]


def predict_fake_players(
    model, features, medians, train_stds: pd.Series
) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    """Predict on every fake-player profile. Returns (predictions_df, input_stats_df, raw_list)."""
    fakes = make_fake_players()
    pred_rows = []
    stats_rows = []
    for fake in fakes:
        row = pd.Series({**medians.to_dict(), **fake["stats"]})
        X = pd.DataFrame([row[features].values], columns=features)
        pred = float(model.predict(X)[0])
        top3 = top_k_stat_improvements(model, row, features, train_stds, k=3)
        pred_rows.append({
            "name": fake["name"],
            "position": fake["position"],
            "age": fake["age"],
            "predicted_fee_eur": pred,
            "predicted_fee_eur_human": f"€{pred/1e6:.1f}M",
            "top3_stat_improvements": _format_top3(top3),
        })
        stats_rows.append({"name": fake["name"], **fake["stats"]})
    return pd.DataFrame(pred_rows), pd.DataFrame(stats_rows), fakes


def main() -> int:
    model, features, medians = _load_artifacts()

    run_id, model_commit = _run_metadata()
    # Per-run dir: predictions/runs/2026-04-30T12:34:56Z/ ...
    run_dir = RUNS_DIR / run_id.replace(":", "")  # macOS-safe
    run_dir.mkdir(parents=True, exist_ok=True)
    log.info("Run %s | commit %s | dir %s", run_id, model_commit or "(no-git)", run_dir)

    seasons = list(range(2014, 2023))
    transfers = load_transfers(seasons=seasons)
    stats = load_fbref_player_stats(seasons=seasons + [s + 1 for s in seasons])
    joined = join_transfers_with_prior_season_stats(transfers, stats, age_tolerance=2)

    train_seasons = {str(s) for s in range(2014, 2021)}
    train_df = joined[joined["season"].astype(str).isin(train_seasons)].copy()
    train_df[features] = train_df[features].fillna(medians)
    train_stds = train_df[features].std()

    log.info("Predicting on full held-out test set...")
    test_preds = _stamp_df(
        predict_test_set(model, features, medians, joined, train_stds),
        run_id, model_commit,
    )
    run_path, latest_path = _write_csv_pair(test_preds, "test_set.csv", run_dir)
    log.info("Wrote %s + %s (%d rows)", run_path, latest_path, len(test_preds))

    sample = test_preds.head(10).copy()
    run_path, latest_path = _write_csv_pair(sample, "sample_top.csv", run_dir)
    log.info("Wrote %s + %s (top 10)", run_path, latest_path)

    log.info("Predicting on synthetic fake players (6 archetypes)...")
    fake_df, fake_stats_df, fakes_raw = predict_fake_players(model, features, medians, train_stds)
    fake_df = _stamp_df(fake_df, run_id, model_commit)
    fake_stats_df = _stamp_df(fake_stats_df, run_id, model_commit)
    _write_csv_pair(fake_df, "fake_players.csv", run_dir)
    _write_csv_pair(fake_stats_df, "fake_players_input_stats.csv", run_dir)

    # Audit log: one JSON line per run.
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
    log.info("Audit row appended to %s", RUNS_DIR / "runs.jsonl")

    # Human-friendly report.
    run_md, latest_md = write_report_md(
        run_dir, run_id, model_commit, test_preds, fake_df, fakes_raw, audit
    )
    log.info("Wrote %s + %s", run_md, latest_md)

    print("\n" + "=" * 80)
    print("Top 10 — 홀드아웃 테스트 셋, 실제 vs 예측 이적료")
    print("=" * 80)
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 12)
    show = test_preds.head(10).copy()
    show["actual"] = (show["actual_fee_eur"] / 1e6).round(1).map(lambda x: f"€{x:>5.1f}M")
    show["predicted"] = (show["predicted_fee_eur"] / 1e6).round(1).map(lambda x: f"€{x:>5.1f}M")
    show["residual"] = (show["residual_eur"] / 1e6).round(1).map(lambda x: f"{x:+.1f}M")
    show["err%"] = (show["abs_pct_error"] * 100).round(0).astype(int).map(lambda x: f"{x}%")
    print(show[["season", "player_name", "to_club", "actual", "predicted", "residual", "err%", "top3_stat_improvements"]].to_string(index=False))

    print("\n" + "=" * 80)
    print("가상 선수 예측")
    print("=" * 80)
    print(fake_df.to_string(index=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
