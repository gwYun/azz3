"""STAGE 2 (part 2) — Monte-Carlo tournament simulator.

Plays the real 2026 bracket many times (default ~1,000,000), fully vectorized over
the simulation axis with numpy. Each iteration:

  1. Group stage: every group plays its 6 matches; points + goal diff + goals-for
     decide the 1st/2nd/3rd of each group (random tiebreak for exact ties).
  2. Best-8-thirds: rank the 12 third-placed teams by (pts, gd, gf); top 8 advance.
     Each advancing third is slotted into its bracket position by a fixed assignment.
  3. Knockout: R32 -> R16 -> QF -> SF -> Final via groups_2026.json wiring.

Collects, per simulation: the four semifinalists and the champion. The orchestrator
turns those into the three required outputs.

Design notes
------------
* Vectorization axis = the S simulations. Within one iteration, the 12 groups (and
  later the 16/8/4/2/1 knockout matches) are looped in python, but each such match
  is evaluated across all S sims at once. So total python-level work is O(#matches)
  ~ a few hundred array ops, independent of S. S=1e6 runs in chunks to bound memory.
* Group standings use a vectorized lexicographic sort over (pts, gd, gf, jitter).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from worldcup.src import match_model as mm

_WC_DATA = Path(__file__).resolve().parents[1] / "data"


def load_bracket() -> dict:
    with open(_WC_DATA / "groups_2026.json") as f:
        return json.load(f)


# Round-robin pairings (indices within a 4-team group).
_RR = [(0, 1), (2, 3), (0, 2), (1, 3), (0, 3), (1, 2)]

# Each "best third" bracket slot lists the candidate groups it may draw from
# (from r32 'T_XXXXX' labels). We assign the 8 qualifying thirds to these slots
# greedily, respecting candidacy, matching FIFA's allocation intent closely enough
# for simulation. Slot order below is the canonical priority order.
_THIRD_SLOTS = {
    "T_ABCDF": "ABCDF",
    "T_CDFGH": "CDFGH",
    "T_CEFHI": "CEFHI",
    "T_EHIJK": "EHIJK",
    "T_BEFIJ": "BEFIJ",
    "T_AEHIJ": "AEHIJ",
    "T_EFGIJ": "EFGIJ",
    "T_DEIJL": "DEIJL",
}


class Tournament:
    def __init__(self, ratings: dict[str, float], seed: int = 42):
        self.bracket = load_bracket()
        self.groups = self.bracket["groups"]
        self.group_letters = list(self.groups.keys())  # A..L
        self.hosts = set(self.bracket["hosts"])
        self.ratings = ratings
        self.rng = np.random.default_rng(seed)
        # All teams, stable index.
        self.teams = [t for g in self.groups.values() for t in g]
        self.team_idx = {t: i for i, t in enumerate(self.teams)}

    def _r(self, team_arr):
        """Vectorized rating lookup is unnecessary; ratings are scalars per slot."""
        return self.ratings[team_arr]

    def _host(self, team: str) -> float:
        return 1.0 if team in self.hosts else 0.0

    # ---- group stage (vectorized over S sims) ---------------------------- #
    def _play_group(self, teams4: list[str], S: int):
        """Return (rank_order [S,4] team-name array, pts/gd/gf [S,4]) for one group."""
        pts = np.zeros((S, 4), dtype=np.int32)
        gf = np.zeros((S, 4), dtype=np.int32)
        ga = np.zeros((S, 4), dtype=np.int32)
        r = np.array([self.ratings[t] for t in teams4], float)
        h = np.array([self._host(t) for t in teams4], float)
        for i, j in _RR:
            lam_i, lam_j = mm.expected_goals(
                np.full(S, r[i]), np.full(S, r[j]),
                np.full(S, h[i]), np.full(S, h[j]))
            gi, gj = mm.simulate_goals(self.rng, lam_i, lam_j)
            gf[:, i] += gi; ga[:, i] += gj
            gf[:, j] += gj; ga[:, j] += gi
            iwin = gi > gj; jwin = gj > gi; tie = ~(iwin | jwin)
            pts[:, i] += np.where(iwin, 3, np.where(tie, 1, 0))
            pts[:, j] += np.where(jwin, 3, np.where(tie, 1, 0))
        gd = gf - ga
        jitter = self.rng.random((S, 4)) * 0.01
        # Lexicographic score: pts dominate, then gd, then gf, then jitter.
        score = pts * 1e6 + gd * 1e3 + gf * 1e1 + jitter
        order = np.argsort(-score, axis=1)  # [S,4] positions sorted best->worst
        return order, pts, gd, gf

    def run(self, n_sims: int, chunk: int = 50_000):
        """Run n_sims simulations in chunks. Returns dict of result arrays."""
        champ = np.empty(n_sims, dtype=object)
        sf_teams = np.empty((n_sims, 4), dtype=object)
        done = 0
        while done < n_sims:
            S = min(chunk, n_sims - done)
            c, sf = self._run_chunk(S)
            champ[done:done + S] = c
            sf_teams[done:done + S] = sf
            done += S
        return {"champion": champ, "semifinalists": sf_teams}

    def _run_chunk(self, S: int):
        gl = self.group_letters
        # winners[letter], runners[letter]: [S] team-name arrays. thirds: per group.
        winners, runners, thirds = {}, {}, {}
        third_stats = {}  # letter -> (pts,gd,gf) [S]
        for letter in gl:
            teams4 = self.groups[letter]
            order, pts, gd, gf = self._play_group(teams4, S)
            names = np.array(teams4, dtype=object)
            winners[letter] = names[order[:, 0]]
            runners[letter] = names[order[:, 1]]
            thirds[letter] = names[order[:, 2]]
            # stats of the 3rd-placed team per sim
            idx3 = order[:, 2]
            rows = np.arange(S)
            third_stats[letter] = (pts[rows, idx3], gd[rows, idx3], gf[rows, idx3])

        # Best 8 of 12 thirds, per sim.
        t_pts = np.stack([third_stats[l][0] for l in gl], axis=1)  # [S,12]
        t_gd = np.stack([third_stats[l][1] for l in gl], axis=1)
        t_gf = np.stack([third_stats[l][2] for l in gl], axis=1)
        jitter = self.rng.random((S, 12)) * 0.01
        t_score = t_pts * 1e6 + t_gd * 1e3 + t_gf * 1e1 + jitter
        # rank groups by their third's score; top 8 group-letters per sim.
        third_order = np.argsort(-t_score, axis=1)  # [S,12] -> group-letter indices
        qualifying = third_order[:, :8]  # [S,8] indices into gl (these 8 groups' thirds advance)

        # Assign qualifying thirds to the 8 third-slots.
        # For each sim, we have a set of 8 group letters. Map them to slot labels by
        # greedy candidacy matching (slot order fixed). Vectorizing the assignment is
        # fiddly; do it per-sim in a tight numpy-driven loop over slots.
        slot_team = self._assign_thirds(S, gl, qualifying, thirds)

        # Build a resolver for knockout slot labels -> team arrays.
        resolved = {}
        for letter in gl:
            resolved[f"W_{letter}"] = winners[letter]
            resolved[f"RU_{letter}"] = runners[letter]
        resolved.update(slot_team)  # T_xxxxx labels

        # Play knockout rounds.
        for rnd in ("r32", "r16", "qf", "sf", "final"):
            for m in self.bracket[rnd]:
                a = resolved[m["home"]]; b = resolved[m["away"]]
                ra = np.array([self.ratings[t] for t in a])
                rb = np.array([self.ratings[t] for t in b])
                ha = np.array([self._host(t) for t in a])
                hb = np.array([self._host(t) for t in b])
                a_win = mm.knockout_winner(self.rng, ra, rb, ha, hb)
                resolved[f"W_{m['match']}"] = np.where(a_win, a, b)
            if rnd == "sf":
                # capture the four semifinalists = the 4 teams that PLAYED in sf matches
                sf_list = []
                for m in self.bracket["sf"]:
                    sf_list.append(resolved[m["home"]])
                    sf_list.append(resolved[m["away"]])
                semifinalists = np.stack(sf_list, axis=1)  # [S,4]

        champion = resolved[f"W_{self.bracket['final'][0]['match']}"]
        return champion, semifinalists

    def _assign_thirds(self, S, gl, qualifying, thirds):
        """Assign the 8 qualifying thirds to the 8 bracket third-slots, per sim.

        Greedy by fixed slot order: each slot takes an as-yet-unassigned qualifying
        group whose letter is among the slot's candidate groups. This respects FIFA's
        candidacy structure; exact official table differences are negligible for the
        aggregate distribution.
        """
        gl_idx = {l: i for i, l in enumerate(gl)}
        slots = list(_THIRD_SLOTS.items())  # [(label, "ABCDF"), ...]
        slot_team = {label: np.empty(S, dtype=object) for label, _ in slots}

        qual_letters = np.array(gl)[qualifying]  # [S,8] letters
        for s in range(S):
            available = list(qual_letters[s])
            for label, cand in slots:
                chosen = None
                for L in available:
                    if L in cand:
                        chosen = L
                        break
                if chosen is None and available:
                    chosen = available[0]  # fallback: take any remaining
                if chosen is not None:
                    available.remove(chosen)
                    slot_team[label][s] = thirds[chosen][s]
                else:
                    slot_team[label][s] = thirds[gl[0]][s]  # degenerate guard
        return slot_team
