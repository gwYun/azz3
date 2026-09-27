"""Invariant tests for the KBO model (network-free, synthetic inputs).

These defend the highest-risk properties of the KBO pipeline without hitting the
KBO record site: the sabermetric calibration identities, the run model's dispersion,
and the simulators' bookkeeping.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from kbo.src import data, game_model as gm, sabermetrics as sm
from kbo.src.season_simulate import Season
from kbo.src import postseason as post
from kbo.src.team_strength_kbo import pythag_winpct


# --- a synthetic, self-consistent constants dict (no network) -------------- #
def _constants():
    return {
        "lg_wOBA": 0.330, "wOBA_scale": 1.05, "lg_OBP": 0.3465,
        "lg_R_per_PA": 0.13, "lg_R_per_G": 4.8,
        "lg_ERA": 4.50, "lg_FIP": 4.50, "FIP_const": 3.20, "RPW": 10.5,
        "replacement_runs_per_600pa": 20.0, "replacement_fip_factor": 1.10,
    }


def test_wrc_plus_is_100_at_league_average():
    """A batter whose wOBA equals league wOBA must land at exactly wRC+ 100."""
    c = _constants()
    assert abs(sm.wrc_plus(_eq_woba_frame(c), c).iloc[0] - 100.0) < 1e-6


def _eq_woba_frame(c):
    """A 1-row frame engineered so its wOBA equals lg_wOBA exactly."""
    w = sm.WOBA_WEIGHTS
    # denominator = AB (no walks/sf/hbp); numerator = w1B*B1; pick B1 so woba==lg_wOBA
    AB = 1000.0
    target_num = c["lg_wOBA"] * AB
    B1 = target_num / w["1B"]
    return pd.DataFrame([{"AB": AB, "BB": 0, "IBB": 0, "HBP": 0, "SF": 0,
                          "B1": B1, "B2": 0, "B3": 0, "HR": 0, "PA": AB}])


def test_fip_equals_era_at_league_average():
    """A pitcher with the league-average FIP kernel must get FIP == league ERA."""
    c = _constants()
    # kernel(13HR+3(BB+HBP)-2SO)/IP must equal lg_ERA - FIP_const = 1.30
    kernel_target = c["lg_ERA"] - c["FIP_const"]
    IP = 100.0
    # pick HR/BB/SO so the kernel hits the target: 13*HR/IP = kernel_target, others 0
    HR = kernel_target * IP / 13.0
    pit = pd.DataFrame([{"HR": HR, "BB": 0, "HBP": 0, "SO": 0, "IP": IP}])
    assert abs(sm.fip(pit, c).iloc[0] - c["lg_ERA"]) < 1e-9


def test_negbinom_dispersion_matches_target():
    """Sampled runs have variance ≈ lam + lam²/k (over-dispersed vs Poisson)."""
    rng = np.random.default_rng(0)
    lam, k = 5.0, gm.DISPERSION_K
    runs = gm.simulate_runs(rng, np.full(400000, lam), k)
    expected_var = lam + lam ** 2 / k
    assert abs(runs.mean() - lam) < 0.05
    assert abs(runs.var() - expected_var) < 0.3
    assert runs.var() > lam  # strictly over-dispersed (not Poisson)


def test_expected_runs_log5():
    """Even teams score the league average; a strong offense scales up."""
    lg = 4.8
    assert abs(gm.expected_runs(np.array([lg]), np.array([lg]), lg)[0] - lg) < 1e-9
    strong = gm.expected_runs(np.array([6.0]), np.array([lg]), lg)[0]
    assert abs(strong - 6.0) < 1e-9


def test_pythag_winpct_bounds():
    rs = np.array([5.5, 4.0, 4.8])
    ra = np.array([4.0, 5.5, 4.8])
    wp = pythag_winpct(rs, ra)
    assert (wp > 0).all() and (wp < 1).all()
    assert wp[0] > 0.5 and wp[1] < 0.5
    assert abs(wp[2] - 0.5) < 1e-6           # equal RS/RA -> .500


def test_season_wins_are_conserved():
    """Every team plays 144-equivalent games; with ties resolved, total wins ==
    total games and each team's W+L == its game count (no leakage)."""
    rs = {"A": 5.2, "B": 4.8, "C": 4.4}
    ra = {"A": 4.4, "B": 4.8, "C": 5.2}
    sea = Season(rs, ra, lg_rg=4.8, seed=1)
    out = sea.run(400, chunk=200)
    n = len(rs)
    games_per_team = 8 * 2 * (n - 1)        # 8 home per ordered pair
    total_games = games_per_team * n // 2
    assert abs(sum(out["mean_wins"].values()) - total_games) < 1e-6
    # ranking favors the team that outscores its run prevention
    ranked = sorted(out["mean_wins"], key=lambda t: -out["mean_wins"][t])
    assert ranked[0] == "A" and ranked[-1] == "C"


def test_postseason_probabilities_sum():
    """Champion probabilities sum to 1; KS participants sum to 2 (two per sim)."""
    rng = np.random.default_rng(3)
    S, n = 20000, 10
    # seeds: same ordering every sim (team 0 best) for a clean check
    seeds = np.tile(np.arange(5), (S, 1))
    rs = np.tile(np.linspace(5.4, 4.2, n), (S, 1))
    ra = np.tile(np.linspace(4.2, 5.4, n), (S, 1))
    champ, ks = post.simulate_postseason(rng, seeds, rs, ra, lg_rg=4.8)
    assert len(champ) == S
    champ_counts = np.bincount(champ, minlength=n)
    assert champ_counts.sum() == S
    assert ks.shape == (S, 2)
    # top seed (0) should win most often (waits for the Korean Series)
    assert champ_counts.argmax() == 0


def test_franchise_alias_resolution():
    """Historical / variant names map onto the current franchise codes."""
    assert data.resolve_team("넥센") == "WO"      # Nexen -> Kiwoom franchise
    assert data.resolve_team("SK") == "SK"        # SK -> SSG keeps the code
    assert data.resolve_team("기아") == "HT"
    assert data.resolve_team("KIA") == "HT"
    assert data.resolve_team("없는팀") is None
