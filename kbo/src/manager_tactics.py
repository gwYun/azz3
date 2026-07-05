"""Manager tactic presets (v2, user step 5) — small, disclosed, ablatable.

Real managers differ in how they deploy a roster; this layer captures two defensible,
data-grounded levers and applies them *modestly* (never tuned to a chosen champion, and
switchable off via `weight=0` for the sensitivity ablation):

  * **bullpen_leverage** — teams that "shorten the game" shift innings from the weak
    back-of-rotation toward their best relievers. Implemented as a small reallocation of
    `alloc_ip` from the #4–5 starters to the top bullpen arms.
  * **aggression** — a tiny offensive multiplier for teams whose style (contact, running
    game) squeezes out marginal runs; ±a couple percent at the extremes.

Presets are keyed by franchise and can be data-derived per season; the defaults are
mild and symmetric so no team gets an unearned edge.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Neutral defaults; a caller may override per franchise from historical tendencies.
DEFAULT = {"bullpen_leverage": 0.0, "aggression": 1.0}


def derive_presets(pitching: pd.DataFrame) -> dict:
    """Light, data-grounded leverage: teams whose bullpen out-performs their rotation
    (lower RP FIP vs SP FIP) get a positive bullpen_leverage. Symmetric, small."""
    if "FIP" not in pitching.columns or pitching.empty:
        return dict(DEFAULT)
    sp = pitching[pitching["role"] == "SP"]["FIP"]
    rp = pitching[pitching["role"] == "RP"]["FIP"]
    if len(sp) == 0 or len(rp) == 0:
        return dict(DEFAULT)
    gap = float(sp.mean() - rp.mean())            # >0 means bullpen is the strength
    return {"bullpen_leverage": float(np.clip(gap / 4.0, -0.15, 0.15)), "aggression": 1.0}


def apply_bullpen_leverage(pitch_alloc: pd.DataFrame, leverage: float, weight: float = 1.0) -> pd.DataFrame:
    """Shift a small slice of IP from the weakest rotation arms to the best bullpen arms."""
    if weight == 0 or leverage == 0 or pitch_alloc.empty:
        return pitch_alloc
    p = pitch_alloc.copy()
    shift = weight * leverage
    rot = p[p.get("staff_role", "rotation") == "rotation"].sort_values("WAR")
    pen = p[p.get("staff_role", "bullpen") == "bullpen"].sort_values("WAR", ascending=False)
    if len(rot) == 0 or len(pen) == 0:
        return p
    take = rot["alloc_ip"].head(2) * abs(shift)   # from the two weakest starters
    moved = float(take.sum()) * np.sign(shift)
    p.loc[take.index, "alloc_ip"] -= take.values * np.sign(shift)
    top_pen = pen.index[: min(2, len(pen))]
    p.loc[top_pen, "alloc_ip"] += moved / len(top_pen)
    p["alloc_ip"] = p["alloc_ip"].clip(lower=0)
    return p
