"""ValueTrack KBO — head-to-head matchup export (야구 승부 예측).

Builds the per-player ingredients the browser simulator needs (batter/pitcher event
rates, modeled rotation, projected lineup, per-team calibration) from the real full
/Record rosters, and writes kbo-matchup.json to kbo/outputs + web/public. No game
simulation happens here — the base-out Markov + 1,000,000-draw Monte Carlo run
client-side (web/lib/matchup-sim.ts) so the user can pick teams, lineups, and rotation
state and re-simulate live.

Run:  python -m kbo.scripts.run_matchup --season 2026
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from datetime import datetime, timezone

from kbo.src import config, matchup_export as mx

_OUT = config.OUTPUTS_DIR / "kbo-matchup.json"
_WEB = config.PROJECT_ROOT / "web" / "public" / "kbo-matchup.json"


def _git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       cwd=str(config.PROJECT_ROOT)).decode().strip()
    except Exception:
        return "unknown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=config.CURRENT_SEASON)
    ap.add_argument("--no-web-copy", action="store_true")
    args = ap.parse_args()

    print(f"[matchup] {args.season} 전 구단 전체 로스터 → 매치업 재료 export …")
    payload = mx.assemble_matchup(args.season)
    payload["run_id"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload["model_commit"] = _git_commit()

    config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if not args.no_web_copy:
        _WEB.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_OUT, _WEB)

    n_bat = sum(len(t["batters"]) for t in payload["teams"])
    print(f"  teams={len(payload['teams'])}  batters={n_bat}  "
          f"lg R/G={payload['league']['lg_R_per_G']}  k={payload['league']['k']}")
    for t in payload["teams"]:
        print(f"    {t['ko']:<4} rs={t['rs_per_game']:.2f} ra={t['ra_per_game']:.2f} "
              f"calib={t['mu_calib']:.3f} rotation={len(t['rotation'])}")
    print(f"  -> {_OUT}" + ("" if args.no_web_copy else f" · {_WEB}"))


if __name__ == "__main__":
    main()
