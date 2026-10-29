/**
 * Draft-model data from Leaguepedia: one record per GAME with the full pick/ban
 * order, roles, players and result.
 *
 *   ScoreboardGames   game header (patch, sides, winner, length)
 *   PicksAndBansS7    draft ORDER (Team1 = blue): bans 1-3 / picks 1-3 / bans 4-5 / picks 4-5
 *   ScoreboardPlayers who played which champion in which role (+ KDA, gold)
 *
 * Two scopes: TIER-1 (LCK/LPL/LEC/LCS/LCP/CBLOL + MSI/EWC/Worlds) for team and
 * player tendencies, and META (every league) on recent patches for champion
 * strength — lower tiers follow the pro meta and multiply the sample.
 */
import { Leaguepedia } from "../leaguepedia";

export const TIER1_PAGES = [
  "LCK/2026 Season/%", "LPL/2026 Season/%", "LEC/2026 Season/%", "LCS/2026 Season/%",
  "LCP/2026 Season/%", "CBLOL/2026 Season/%", "2026 Mid-Season Invitational%", "Esports World Cup 2026%",
  "2026 Season World Championship/%", "2026 First Stand%",
];

export const ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"] as const;
export type Role = (typeof ROLES)[number];

export interface DraftPlayer {
  player: string;      // Leaguepedia Link (stable player page)
  champion: string;
  role: Role;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
}

export interface DraftGame {
  gameId: string;
  matchId: string;
  page: string;          // OverviewPage
  tier1: boolean;
  t: string;             // DateTime_UTC
  patch: string;
  gameInMatch: number;
  blue: string;          // team names (Leaguepedia)
  red: string;
  blueWin: boolean;
  lengthMin: number | null;
  // Draft order — blue/red bans and picks in the order they were made.
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
  blueRoster: DraftPlayer[];
  redRoster: DraftPlayer[];
}

const split = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter((x) => x && x !== "None");
const num = (s: string | undefined) => (s == null || s === "" ? 0 : Number(s));
const roleOf = (r: string): Role | null => {
  const k = r.toLowerCase();
  if (k.startsWith("top")) return "Top";
  if (k.startsWith("jun")) return "Jungle";
  if (k.startsWith("mid")) return "Mid";
  if (k.startsWith("bot") || k === "adc") return "Bot";
  if (k.startsWith("sup")) return "Support";
  return null;
};
const orWhere = (pages: string[]) => "(" + pages.map((p) => `SG.OverviewPage LIKE '${p}'`).join(" OR ") + ")";

export async function collectDraftGames(opts: { metaFromPatch?: string; since?: string } = {}): Promise<DraftGame[]> {
  const lp = new Leaguepedia();
  await lp.login();
  const since = opts.since ?? "2026-01-01";
  const metaFrom = opts.metaFromPatch ?? "26.18";
  const tier1Where = orWhere(TIER1_PAGES);
  // META scope: any league, recent patches (PatchSort sorts numerically; Patch is text like '26.20').
  const scope = `SG.DateTime_UTC >= '${since}' AND (${tier1Where} OR SG.Patch >= '${metaFrom}')`;

  const games = await lp.cargo({
    tables: "ScoreboardGames=SG",
    fields: "SG.GameId=gameId, SG.MatchId=matchId, SG.OverviewPage=page, SG.DateTime_UTC=t, SG.Patch=patch, SG.N_GameInMatch=gim, SG.Team1=team1, SG.Team2=team2, SG.WinTeam=win, SG.Gamelength_Number=len, SG.Team1Bans=b1, SG.Team2Bans=b2, SG.Team1Picks=p1, SG.Team2Picks=p2",
    where: scope,
    orderBy: "SG.DateTime_UTC",
  });
  const pb = await lp.cargo({
    tables: "PicksAndBansS7=PB, ScoreboardGames=SG",
    joinOn: "PB.GameId=SG.GameId",
    fields: [
      "PB.GameId=gameId",
      ...[1, 2].flatMap((t) => [1, 2, 3, 4, 5].flatMap((i) => [`PB.Team${t}Ban${i}=t${t}b${i}`, `PB.Team${t}Pick${i}=t${t}p${i}`])),
    ].join(", "),
    where: scope,
  });
  const players = await lp.cargo({
    tables: "ScoreboardPlayers=SP, ScoreboardGames=SG",
    joinOn: "SP.GameId=SG.GameId",
    fields: "SP.GameId=gameId, SP.Link=player, SP.Team=team, SP.Champion=champ, SP.Role=role, SP.Side=side, SP.Kills=k, SP.Deaths=d, SP.Assists=a, SP.Gold=gold",
    where: scope,
  });

  const pbBy = new Map(pb.map((r) => [r.gameId, r]));
  const rosterBy = new Map<string, { 1: DraftPlayer[]; 2: DraftPlayer[] }>();
  for (const p of players) {
    const role = roleOf(p.role ?? "");
    if (!role) continue;
    const e = rosterBy.get(p.gameId) ?? { 1: [], 2: [] };
    (p.side === "2" ? e[2] : e[1]).push({
      player: p.player, champion: p.champ, role, kills: num(p.k), deaths: num(p.d), assists: num(p.a), gold: num(p.gold),
    });
    rosterBy.set(p.gameId, e);
  }

  const tier1Re = new RegExp("^(" + TIER1_PAGES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")).join("|") + ")$");
  const out: DraftGame[] = [];
  for (const g of games) {
    if (!g.win) continue; // unplayed / placeholder
    const d = pbBy.get(g.gameId);
    const ro = rosterBy.get(g.gameId);
    const ordered = (t: 1 | 2, kind: "b" | "p") =>
      d ? [1, 2, 3, 4, 5].map((i) => d[`t${t}${kind}${i}`]).filter((x) => x && x !== "None") : [];
    out.push({
      gameId: g.gameId, matchId: g.matchId, page: g.page, tier1: tier1Re.test(g.page), t: g.t, patch: g.patch,
      gameInMatch: num(g.gim) || 1, blue: g.team1, red: g.team2, blueWin: g.win === g.team1,
      lengthMin: g.len ? Number(g.len) : null,
      blueBans: d ? ordered(1, "b") : split(g.b1), redBans: d ? ordered(2, "b") : split(g.b2),
      bluePicks: d ? ordered(1, "p") : split(g.p1), redPicks: d ? ordered(2, "p") : split(g.p2),
      blueRoster: ro?.[1] ?? [], redRoster: ro?.[2] ?? [],
    });
  }
  return out;
}
