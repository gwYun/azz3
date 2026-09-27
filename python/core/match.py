"""Layered player ID matching across data sources.

Strategy (locked in eng-review Issue 1A):
  1. soccerdata's built-in cross-source IDs where they exist
  2. Exact match on (name, dob, nationality)
  3. RapidFuzz fuzzy match on name (threshold 90)
  4. Unmatched -> manual review queue CSV

The single highest-risk path in this MVP. Silent mismatches train the
model on garbage labels.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from rapidfuzz import fuzz, process

from . import config


@dataclass
class MatchResult:
    matched: pd.DataFrame  # rows joined cleanly
    review_queue: pd.DataFrame  # rows that need manual eyeball


def match_players(
    stats: pd.DataFrame,
    transfers: pd.DataFrame,
    name_col_stats: str = "player",
    name_col_transfers: str = "player",
    dob_col_stats: str | None = "born",
    dob_col_transfers: str | None = "dob",
    nationality_col_stats: str | None = "nation",
    nationality_col_transfers: str | None = "nationality",
    fuzzy_threshold: int = config.FUZZY_MATCH_THRESHOLD,
) -> MatchResult:
    """Layered match. Returns matched rows and a review queue of unmatched.

    Either side may be missing dob/nationality — in that case those layers are
    skipped and we fall through to fuzzy match.
    """
    if stats.empty or transfers.empty:
        return MatchResult(
            matched=pd.DataFrame(),
            review_queue=pd.DataFrame(),
        )

    work_stats = stats.copy()
    work_transfers = transfers.copy()
    work_stats["_stat_idx"] = range(len(work_stats))
    work_transfers["_xfer_idx"] = range(len(work_transfers))

    # Layer 2: exact name + dob + nationality (case-insensitive normalize).
    join_keys = [name_col_stats]
    if dob_col_stats and dob_col_stats in work_stats.columns and dob_col_transfers in work_transfers.columns:
        work_stats[dob_col_stats] = pd.to_datetime(work_stats[dob_col_stats], errors="coerce").dt.date
        work_transfers[dob_col_transfers] = pd.to_datetime(
            work_transfers[dob_col_transfers], errors="coerce"
        ).dt.date

    work_stats[name_col_stats] = work_stats[name_col_stats].astype(str).str.strip().str.lower()
    work_transfers[name_col_transfers] = (
        work_transfers[name_col_transfers].astype(str).str.strip().str.lower()
    )

    left_keys = [name_col_stats]
    right_keys = [name_col_transfers]
    if dob_col_stats and dob_col_stats in work_stats.columns and dob_col_transfers in work_transfers.columns:
        left_keys.append(dob_col_stats)
        right_keys.append(dob_col_transfers)
    if (
        nationality_col_stats
        and nationality_col_stats in work_stats.columns
        and nationality_col_transfers in work_transfers.columns
    ):
        work_stats[nationality_col_stats] = work_stats[nationality_col_stats].astype(str).str.lower()
        work_transfers[nationality_col_transfers] = (
            work_transfers[nationality_col_transfers].astype(str).str.lower()
        )
        left_keys.append(nationality_col_stats)
        right_keys.append(nationality_col_transfers)

    # Build a left/right merge that disambiguates suffix collisions.
    exact = work_stats.merge(
        work_transfers, left_on=left_keys, right_on=right_keys, how="inner", suffixes=("_s", "_t")
    )

    matched_xfer_idx = set(exact["_xfer_idx"].tolist())
    remaining_transfers = work_transfers[~work_transfers["_xfer_idx"].isin(matched_xfer_idx)].copy()

    # Layer 3: fuzzy on name only, scoped to remaining transfers.
    if not remaining_transfers.empty:
        candidate_names = work_stats[name_col_stats].unique().tolist()
        name_to_stat_rows = work_stats.groupby(name_col_stats).indices

        fuzzy_rows = []
        review_rows = []
        for _, xfer_row in remaining_transfers.iterrows():
            target = xfer_row[name_col_transfers]
            best = process.extractOne(target, candidate_names, scorer=fuzz.WRatio)
            if best and best[1] >= fuzzy_threshold:
                stat_idxs = name_to_stat_rows[best[0]]
                # If multiple stat rows share the fuzzy-matched name, send to review:
                # we cannot pick a winner without DOB.
                if len(stat_idxs) == 1:
                    stat_row = work_stats.iloc[stat_idxs[0]].to_dict()
                    fuzzy_rows.append({**stat_row, **xfer_row.to_dict(), "_match_layer": "fuzzy"})
                else:
                    review_rows.append({**xfer_row.to_dict(), "_reason": "fuzzy_collision"})
            else:
                review_rows.append(
                    {**xfer_row.to_dict(), "_reason": f"no_match_score_{best[1] if best else 0}"}
                )

        fuzzy_df = pd.DataFrame(fuzzy_rows)
        review_df = pd.DataFrame(review_rows)
    else:
        fuzzy_df = pd.DataFrame()
        review_df = pd.DataFrame()

    exact["_match_layer"] = "exact"
    matched = pd.concat([exact, fuzzy_df], ignore_index=True) if not fuzzy_df.empty else exact

    # Persist the review queue for manual eyeball.
    if not review_df.empty:
        review_path = config.REVIEW_QUEUE_DIR / "unmatched.csv"
        review_df.to_csv(review_path, index=False)

    return MatchResult(matched=matched.reset_index(drop=True), review_queue=review_df.reset_index(drop=True))
