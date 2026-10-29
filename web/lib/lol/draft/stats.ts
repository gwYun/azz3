/**
 * Draft statistics — weighted, shrunk tables learned from DraftGame records.
 *
 * Every game carries a weight: tournament games (the event we predict) count
 * `eventWeight`× because Worlds re-sorts the meta (new counters, new priority
 * picks); other games decay with PATCH distance from the event patch, and
 * non-tier-1 games only feed champion meta (they follow the pro meta, but say
 * nothing about pro teams/players).
 *
 *   meta[c]          champion strength: shrunk log-odds win rate + log presence
 *   comfort[p][c]    player p on champion c: shrunk weighted games + win rate
 *   teamPick[t][c]   team t's pick share of c; teamBan[t][c] ban share
 *   lane[r][c1][c2]  role-r matchup log-odds (c1 vs c2), heavily shrunk
 */
import type { DraftGame, Role } from "./collect";

export interface WeightOptions {
  eventPage: string;        // OverviewPage prefix of the event (Worlds)
  eventPatch: string;       // e.g. '26.20'
  eventWeight: number;      // multiplier for event games
  patchHalfLife: number;    // weight halves every N patches away
  lowTierWeight: number;    // non-tier-1 games (meta only)
  lanePrior: number;        // pseudo-games pulling each lane matchup to 50%
}

export const DEFAULT_WEIGHTS: WeightOptions = {
  eventPage: "2026 Season World Championship",
  eventPatch: "26.20",
  eventWeight: 4,
  patchHalfLife: 3,
  lowTierWeight: 0.3,
  lanePrior: 60,
};

const patchNum = (p: string) => {
  const [a, b] = p.split(".").map(Number);
  return (a || 0) * 100 + (b || 0);
};

export function gameWeight(g: DraftGame, o: WeightOptions): { meta: number; pro: number } {
  if (g.page.startsWith(o.eventPage)) return { meta: o.eventWeight, pro: o.eventWeight };
  const dist = Math.max(0, patchNum(o.eventPatch) - patchNum(g.patch));
  const w = Math.pow(0.5, dist / o.patchHalfLife);
  return g.tier1 ? { meta: w, pro: w } : { meta: w * o.lowTierWeight, pro: 0 };
}

type Tab = Map<string, number>;
const add = (m: Tab, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export interface DraftStats {
  champions: string[];
  meta: Map<string, number>;              // standardized meta score
  presence: Map<string, number>;          // weighted (picks+bans)/games
  winLogit: Map<string, number>;          // shrunk log-odds
  comfort: Map<string, Map<string, number>>;   // player → champ → score
  playerGames: Map<string, Map<string, number>>; // player → champ → weighted games
  teamPick: Map<string, Map<string, number>>;  // team → champ → share
  teamBan: Map<string, Map<string, number>>;
  lane: Map<string, number>;              // `${role}|${c1}|${c2}` → log-odds for c1
  roleOfChamp: Map<string, Map<Role, number>>; // champ → role → share
  totalWeight: number;
}

const logit = (p: number) => Math.log(p / (1 - p));

/** Build stats from games strictly before `asOf` (ISO). */
export function buildStats(games: DraftGame[], asOf: string, o: WeightOptions = DEFAULT_WEIGHTS): DraftStats {
  const champW = new Map<string, { w: number; win: number; pres: number }>();
  const pGames = new Map<string, Tab>();
  const pWins = new Map<string, Tab>();
  const tPick = new Map<string, Tab>();
  const tBan = new Map<string, Tab>();
  const tGames = new Map<string, number>();
  const laneW = new Map<string, { w: number; win: number }>();
  const roleW = new Map<string, Map<Role, number>>();
  let total = 0;
  const ch = (c: string) => {
    let e = champW.get(c);
    if (!e) { e = { w: 0, win: 0, pres: 0 }; champW.set(c, e); }
    return e;
  };

  for (const g of games) {
    if (g.t >= asOf) continue;
    const { meta: wm, pro: wp } = gameWeight(g, o);
    if (wm <= 0) continue;
    total += wm;
    for (const [picks, bans, roster, won] of [
      [g.bluePicks, g.blueBans, g.blueRoster, g.blueWin],
      [g.redPicks, g.redBans, g.redRoster, !g.blueWin],
    ] as const) {
      for (const c of picks) { const e = ch(c); e.w += wm; e.win += won ? wm : 0; e.pres += wm; }
      for (const c of bans) ch(c).pres += wm;
      for (const p of roster) {
        const r = roleW.get(p.champion) ?? new Map<Role, number>();
        r.set(p.role, (r.get(p.role) ?? 0) + wm);
        roleW.set(p.champion, r);
      }
      if (wp > 0) {
        for (const p of roster) {
          const gm = pGames.get(p.player) ?? new Map(); add(gm, p.champion, wp); pGames.set(p.player, gm);
          const wn = pWins.get(p.player) ?? new Map(); add(wn, p.champion, won ? wp : 0); pWins.set(p.player, wn);
        }
      }
    }
    if (wp > 0) {
      for (const [team, picks, bans] of [[g.blue, g.bluePicks, g.blueBans], [g.red, g.redPicks, g.redBans]] as const) {
        tGames.set(team, (tGames.get(team) ?? 0) + wp);
        const pm = tPick.get(team) ?? new Map(); for (const c of picks) add(pm, c, wp); tPick.set(team, pm);
        const bm = tBan.get(team) ?? new Map(); for (const c of bans) add(bm, c, wp); tBan.set(team, bm);
      }
    }
    // Lane matchups (same role across sides).
    for (const b of g.blueRoster) {
      const r = g.redRoster.find((x) => x.role === b.role);
      if (!r) continue;
      for (const [a, z, won] of [[b.champion, r.champion, g.blueWin], [r.champion, b.champion, !g.blueWin]] as const) {
        const k = `${b.role}|${a}|${z}`;
        const e = laneW.get(k) ?? { w: 0, win: 0 };
        e.w += wm; e.win += won ? wm : 0;
        laneW.set(k, e);
      }
    }
  }

  // Champion meta: win-rate log-odds shrunk with a 20-game prior + log presence.
  const PRIOR_N = 20;
  const winLogit = new Map<string, number>();
  const presence = new Map<string, number>();
  const games2 = Math.max(total, 1);
  for (const [c, e] of champW) {
    winLogit.set(c, logit((e.win + PRIOR_N * 0.5) / (e.w + PRIOR_N)));
    presence.set(c, e.pres / games2); // ≈ fraction of team-drafts it appears in (×2 sides)
  }
  const raw = [...champW.keys()].map((c) => Math.log(presence.get(c)! + 1e-3) + 4 * winLogit.get(c)!);
  const mu = raw.reduce((s, x) => s + x, 0) / Math.max(raw.length, 1);
  const sd = Math.sqrt(raw.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(raw.length, 1)) || 1;
  const meta = new Map([...champW.keys()].map((c, i) => [c, (raw[i] - mu) / sd]));

  // Player comfort: log(1 + weighted games) + shrunk win-rate log-odds (10-game prior).
  const comfort = new Map<string, Map<string, number>>();
  for (const [p, gm] of pGames) {
    const m = new Map<string, number>();
    for (const [c, n] of gm) {
      const w = pWins.get(p)!.get(c) ?? 0;
      m.set(c, Math.log1p(n) + 2 * logit((w + 5) / (n + 10)));
    }
    comfort.set(p, m);
  }

  const share = (src: Map<string, Tab>) => {
    const out = new Map<string, Map<string, number>>();
    for (const [t, m] of src) {
      const n = tGames.get(t) ?? 1;
      out.set(t, new Map([...m].map(([c, v]) => [c, v / n])));
    }
    return out;
  };

  const lane = new Map<string, number>();
  for (const [k, e] of laneW) lane.set(k, logit((e.win + o.lanePrior * 0.5) / (e.w + o.lanePrior)));

  const roleOfChamp = new Map<string, Map<Role, number>>();
  for (const [c, m] of roleW) {
    const s = [...m.values()].reduce((a, b) => a + b, 0);
    roleOfChamp.set(c, new Map([...m].map(([r, v]) => [r, v / s])));
  }

  return {
    champions: [...champW.keys()], meta, presence, winLogit, comfort, playerGames: pGames,
    teamPick: share(tPick), teamBan: share(tBan), lane, roleOfChamp, totalWeight: total,
  };
}
