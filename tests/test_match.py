"""Golden-sample tests for the layered player ID match.

The single highest-risk path in this MVP. These tests defend against silent
mismatches that would train the model on bad labels.
"""
from __future__ import annotations

import pandas as pd

from src.match import match_players


def _stats(rows):
    return pd.DataFrame(rows)


def _xfers(rows):
    return pd.DataFrame(rows)


def test_exact_name_dob_nationality_match():
    """Direct exact match on (name, dob, nationality) — the cleanest case."""
    stats = _stats([
        {"player": "Bukayo Saka", "born": "2001-09-05", "nation": "ENG", "minutes": 3000, "xg": 8.0},
    ])
    xfers = _xfers([
        {"player": "Bukayo Saka", "dob": "2001-09-05", "nationality": "ENG", "fee": 0},
    ])
    res = match_players(stats, xfers)
    assert len(res.matched) == 1
    assert len(res.review_queue) == 0
    assert res.matched.iloc[0]["_match_layer"] == "exact"


def test_collision_resolved_by_dob():
    """Two Diego Costas: Spain 1988 forward vs. Brazil 1995 forward.
    Exact match on (name, dob, nationality) should pick the right one."""
    stats = _stats([
        {"player": "Diego Costa", "born": "1988-10-07", "nation": "ESP", "minutes": 2500, "xg": 12.0},
        {"player": "Diego Costa", "born": "1995-04-09", "nation": "BRA", "minutes": 1800, "xg": 4.0},
    ])
    # Transfer is for the Spanish Diego Costa.
    xfers = _xfers([
        {"player": "Diego Costa", "dob": "1988-10-07", "nationality": "ESP", "fee": 22_000_000},
    ])
    res = match_players(stats, xfers)
    assert len(res.matched) == 1
    matched_row = res.matched.iloc[0]
    # The matched stat row should be the 1988 Spaniard, not the 1995 Brazilian.
    assert str(matched_row["born"]) == "1988-10-07"
    assert matched_row["nation"].lower() == "esp"


def test_unmatched_lands_in_review_queue():
    """Synthetic nonsense name should fall through fuzzy and end up in review queue."""
    stats = _stats([
        {"player": "Bukayo Saka", "born": "2001-09-05", "nation": "ENG", "minutes": 3000, "xg": 8.0},
    ])
    xfers = _xfers([
        {"player": "Zzzzz Nooneatall", "dob": "1990-01-01", "nationality": "XXX", "fee": 1},
    ])
    res = match_players(stats, xfers)
    # No exact match. Fuzzy score below threshold. Lands in review queue.
    assert len(res.matched) == 0
    assert len(res.review_queue) == 1


def test_fuzzy_match_above_threshold():
    """Slight name variation (accent stripped) should fuzzy-match above threshold."""
    stats = _stats([
        {"player": "Heung-Min Son", "born": "1992-07-08", "nation": "KOR", "minutes": 3200, "xg": 10.5},
    ])
    # Transfer side has the rearranged Korean form, no DOB available.
    xfers = _xfers([
        {"player": "Son Heung-Min", "fee": 30_000_000},
    ])
    res = match_players(
        stats,
        xfers,
        dob_col_stats=None,
        dob_col_transfers=None,
        nationality_col_stats=None,
        nationality_col_transfers=None,
    )
    # Without DOB/nationality, exact layer falls through. Fuzzy should catch it.
    assert len(res.matched) == 1
    assert res.matched.iloc[0]["_match_layer"] == "fuzzy"


def test_empty_inputs_return_empty_results():
    res = match_players(pd.DataFrame(), pd.DataFrame())
    assert res.matched.empty
    assert res.review_queue.empty
