"""Convert the user-provided KBO salary workbook to committed, readable CSVs.

`kbo/data/KBO_선수연봉_통합_v2.xlsx` bundles public Statiz historical top-earner salaries
with the KBO's official 2026 announcement. This one-shot script is the ONLY place the
xlsx is read: it emits two diffable CSVs that become the project's salary source going
forward, so the model pipeline never depends on Excel/openpyxl.

Outputs (committed):
  * kbo/data/salary_reference.csv — one row per (player, season, team). Master table.
  * kbo/data/team_salary_2026.csv — 2026 per-club average salary (real ground truth).

IMPORTANT — this is a CENSORED sample: only salaries >= ₩13.65억 (top earners). It is
actual salary (FA market / service time), NOT WAR value, so within it WAR carries no
usable slope. It is used to validate the WAR→₩ curve only, never to refit it.
See kbo/src/salary_model.py.

Run:  python -m kbo.scripts.convert_salary_xlsx
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from kbo.src import config, data

_XLSX = config.DATA_DIR / "KBO_선수연봉_통합_v2.xlsx"

# Source label normalization (Korean → snake_case).
_SOURCE_MAP = {
    "스탯티즈": "statiz",
    "KBO공식발표": "kbo_official",
    "KBO공식발표(금액미공개)": "kbo_official_undisclosed",
}


def _num(series: pd.Series) -> pd.Series:
    """Coerce a column to numeric, turning sentinels (미공개, -, 공백) into NaN."""
    return pd.to_numeric(
        series.astype(str).str.strip().replace({"미공개": np.nan, "-": np.nan, "": np.nan, "nan": np.nan}),
        errors="coerce",
    )


def build_salary_reference() -> pd.DataFrame:
    """Master player-salary table from the `통합 데이터` sheet (header on the 3rd row)."""
    raw = pd.read_excel(_XLSX, sheet_name="통합 데이터", header=2)
    raw = raw.dropna(how="all")

    df = pd.DataFrame()
    df["player"] = raw["선수"].astype(str).str.strip()
    df["season"] = raw["연도"].astype(int)
    df["team_ko"] = raw["팀"].astype(str).str.strip()
    df["franchise"] = df["team_ko"].map(data.resolve_team)

    unresolved = df.loc[df["franchise"].isna(), "team_ko"].unique()
    if len(unresolved):
        raise ValueError(f"Unresolved team names (add aliases to kbo_team_meta.json): {list(unresolved)}")

    df["salary_manwon"] = _num(raw["연봉(만원)"]).astype("Int64")
    df["salary_won"] = (df["salary_manwon"] * 10_000).astype("Int64")
    df["salary_ok"] = (df["salary_won"].astype("Float64") / 1e8).round(2)
    df["war"] = _num(raw["WAR"])

    pos = raw["포지션"].astype(str).str.strip().replace({"-": np.nan, "nan": np.nan})
    df["position_ko"] = pos
    df["source"] = raw["출처"].astype(str).str.strip().map(_SOURCE_MAP).fillna(raw["출처"].astype(str).str.strip())

    df["is_disclosed"] = df["salary_manwon"].notna()
    # 2026 (>= CURRENT_SEASON) Statiz WAR values are projections/placeholders (some are 0
    # against a ₩14억+ salary); this flag lets the diagnostic drop forward-looking rows.
    df["war_realized"] = df["season"] < config.CURRENT_SEASON

    return df.reset_index(drop=True)


def build_team_salary_2026() -> pd.DataFrame:
    """2026 per-club average-salary table (second block of the `2026 KBO 공식 발표` sheet)."""
    raw = pd.read_excel(_XLSX, sheet_name="2026 KBO 공식 발표", header=None)
    # Locate the sub-table by its header row `순위 | 구단 | 평균 연봉(만원) | 전년 평균(만원) | 인상률(%)`.
    hdr = raw.index[raw[0].astype(str).str.strip() == "순위"]
    if len(hdr) == 0:
        raise ValueError("Could not find the '순위' header row for the team-average table.")
    start = int(hdr[0]) + 1
    block = raw.iloc[start:].copy()
    block = block[_num(block[0]).notna()]  # keep only numbered team rows

    df = pd.DataFrame()
    df["rank"] = _num(block[0]).astype(int)
    df["team_ko"] = block[1].astype(str).str.strip()
    df["franchise"] = df["team_ko"].map(data.resolve_team)
    unresolved = df.loc[df["franchise"].isna(), "team_ko"].unique()
    if len(unresolved):
        raise ValueError(f"Unresolved team names in team-avg table: {list(unresolved)}")

    df["avg_salary_manwon"] = _num(block[2]).astype("Int64")
    df["avg_salary_won"] = (df["avg_salary_manwon"] * 10_000).astype("Int64")
    df["avg_salary_ok"] = (df["avg_salary_won"].astype("Float64") / 1e8).round(2)
    df["prev_avg_manwon"] = _num(block[3]).astype("Int64")
    df["yoy_pct"] = _num(block[4])
    return df.reset_index(drop=True)


def main() -> None:
    ref = build_salary_reference()
    ref_path = config.SALARY_REF_PATH
    ref.to_csv(ref_path, index=False, encoding="utf-8")
    print(f"wrote {ref_path}  ({len(ref)} rows)")
    print(ref["source"].value_counts().to_dict())

    team = build_team_salary_2026()
    team_path = config.TEAM_SALARY_PATH
    team.to_csv(team_path, index=False, encoding="utf-8")
    print(f"wrote {team_path}  ({len(team)} rows)")


if __name__ == "__main__":
    main()
