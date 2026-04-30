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
    fake_stats: dict,
    audit: dict,
) -> tuple[Path, Path]:
    """Compose a human-friendly markdown report for this run.

    Layout: header (run metadata), headline metrics, top-10 + best-5 + worst-5
    tables, fake player section. Mirrored to latest/report.md.
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
        ("season", "Season"),
        ("player_name", "Player"),
        ("to_club", "To"),
        ("actual_fee_eur", "Actual"),
        ("predicted_fee_eur", "Predicted"),
        ("err_pct", "Err %"),
        ("top3_stat_improvements", "Top-3 stat improvements (Δ predicted fee)"),
    ]

    fake_row = fake_df.iloc[0]
    fake_input_lines = "\n".join(f"  - **{k}:** {v}" for k, v in fake_stats.items())

    md = f"""# Prediction Report — `{run_id}`

| Field | Value |
| --- | --- |
| Run ID (UTC) | `{run_id}` |
| Model commit | `{model_commit or '(no-git)'}` |
| Model | xgboost regressor on transfer fee (EUR) |
| Train rows | {audit['n_train']} |
| Test rows | {audit['n_test']} |
| Test MAE | **{_eur(overall_mae)}** |
| Test Spearman ρ | **{spearman:.3f}** |

> Spearman ρ ≈ {spearman:.2f} means the model ranks transfers correctly about
> {(0.5 + spearman/2)*100:.0f}% of the time (random = 50%). Useful as a relative
> ranking signal; absolute predictions tend to underestimate elite-tier transfers.

## Top 10 highest-fee held-out transfers

{_markdown_table(top10, table_cols)}

## 5 best predictions (lowest %error)

{_markdown_table(best5, table_cols)}

## 5 worst predictions (highest %error)

{_markdown_table(worst5, table_cols)}

## Synthetic fake-player

> A 23-year-old right winger with a strong-but-not-elite season. The point is
> to validate the model produces sensible predictions on inputs that aren't in
> the training set, and that the SHAP top-3 surfaces the kind of stat-improvements
> a young attacker would actually be advised to chase.

| Field | Value |
| --- | --- |
| Name | {fake_row['name']} |
| Position | {fake_row['position']} |
| Age | {fake_row['age']} |
| Predicted fee | **{_eur(float(fake_row['predicted_fee_eur']))}** |
| Top-3 stat improvements | `{fake_row['top3_stat_improvements']}` |

**Input stats used:**

{fake_input_lines}

---

*Generated by `scripts/predict.py`. CSV equivalents in this same directory and in `predictions/latest/`. Audit trail: `predictions/runs/runs.jsonl`.*
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


def make_fake_player(features: list[str], medians: pd.Series) -> dict:
    """Synthesize a 23-year-old high-output forward profile.

    Roughly: a Saka/Foden/Saint-Maximin shape — decent minutes, ~13 G+A,
    healthy xG and progressive contribution. All stat values are in the
    realistic range for a Big-5 starter season.
    """
    return {
        "name": "Fictional Forward, 23yo",
        "position": "Right Winger",
        "age": 23,
        "stats": {
            "MP_Playing": 32,
            "Starts_Playing": 28,
            "Min_Playing": 2520,
            "Mins_Per_90_Playing": 28.0,
            "Gls": 9,
            "Ast": 6,
            "G_minus_PK": 9,
            "PK": 0,
            "PKatt": 0,
            "CrdY": 4,
            "CrdR": 0,
            "Gls_Per": 0.32,
            "Ast_Per": 0.21,
            "G+A_Per": 0.54,
            "G_minus_PK_Per": 0.32,
            "G+A_minus_PK_Per": 0.54,
            "xG_Expected": 7.8,
            "npxG_Expected": 7.8,
            "xAG_Expected": 5.2,
            "npxG+xAG_Expected": 13.0,
            "xG_Per": 0.28,
            "xAG_Per": 0.19,
            "xG+xAG_Per": 0.47,
            "npxG_Per": 0.28,
            "npxG+xAG_Per": 0.47,
        },
    }


def predict_fake_player(model, features, medians, train_stds: pd.Series) -> pd.DataFrame:
    fake = make_fake_player(features, medians)
    row = pd.Series({**medians.to_dict(), **fake["stats"]})  # fill any missing with medians
    X = pd.DataFrame([row[features].values], columns=features)
    pred = float(model.predict(X)[0])
    top3 = top_k_stat_improvements(model, row, features, train_stds, k=3)

    df = pd.DataFrame([{
        "name": fake["name"],
        "position": fake["position"],
        "age": fake["age"],
        "predicted_fee_eur": pred,
        "predicted_fee_eur_human": f"€{pred/1e6:.1f}M",
        "top3_stat_improvements": _format_top3(top3),
    }])

    # Per-stat input dump as a separate flattened CSV for transparency.
    stats_df = pd.DataFrame([fake["stats"]])
    return df, stats_df


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

    log.info("Predicting on synthetic fake player...")
    fake_df, fake_stats_df = predict_fake_player(model, features, medians, train_stds)
    fake_df = _stamp_df(fake_df, run_id, model_commit)
    fake_stats_df = _stamp_df(fake_stats_df, run_id, model_commit)
    _write_csv_pair(fake_df, "fake_player.csv", run_dir)
    _write_csv_pair(fake_stats_df, "fake_player_input_stats.csv", run_dir)

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
        "fake_player_predicted_eur": float(fake_df["predicted_fee_eur"].iloc[0]),
        "run_dir": str(run_dir.relative_to(config.PROJECT_ROOT)),
    }
    with open(RUNS_DIR / "runs.jsonl", "a") as f:
        f.write(json.dumps(audit) + "\n")
    log.info("Audit row appended to %s", RUNS_DIR / "runs.jsonl")

    # Human-friendly report.
    fake_stats_dict = make_fake_player(features, medians)["stats"]
    run_md, latest_md = write_report_md(
        run_dir, run_id, model_commit, test_preds, fake_df, fake_stats_dict, audit
    )
    log.info("Wrote %s + %s", run_md, latest_md)

    print("\n" + "=" * 80)
    print("TOP 10 — held-out test set, actual vs predicted fee")
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
    print("FAKE PLAYER PREDICTION")
    print("=" * 80)
    print(fake_df.to_string(index=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
