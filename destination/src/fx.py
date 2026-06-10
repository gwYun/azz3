"""EUR -> USD conversion and Korean press '만 달러' (10,000-USD unit) formatting.

The fee model is EUR-native; the press release quotes USD in 만 달러 units. The
rate is a documented fixed assumption (mirrors the _fx_note discipline in
worldcup/data/tm_squad_values.json).
"""
from __future__ import annotations

# Fixed assumption, June 2026. Disclosed in the report's limitations.
EUR_USD = 1.08


def eur_to_usd(eur: float) -> float:
    return float(eur) * EUR_USD


def _man(usd: float) -> int:
    """USD -> 만(10,000) units, rounded to the nearest 만."""
    return int(round(usd / 10_000.0))


def format_usd_man(usd: float) -> str:
    """e.g. 150_000_000 -> '약 1.5억 달러' style is avoided; press uses 만 달러."""
    return f"약 {_man(usd):,}만 달러"


def format_usd_man_range(low_usd: float, high_usd: float) -> str:
    """e.g. '약 1억 4,040만~1억 7,280만 달러' -> we keep it in plain 만 units:
    '약 14,040만~17,280만 달러'. Low/high are USD amounts.
    """
    lo, hi = _man(low_usd), _man(high_usd)
    if lo == hi:
        return f"약 {lo:,}만 달러"
    return f"약 {lo:,}만~{hi:,}만 달러"
