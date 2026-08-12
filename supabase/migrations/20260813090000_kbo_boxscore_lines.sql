-- Per-game box-score lines — the full-roster source for the live /matchup engine.
--
-- The Naver /players leaderboard is capped at ~50 rows/sort (≈84 distinct hitters
-- league-wide), too few to rebuild every team's 9-man lineup. The per-game
-- box-score endpoint (schedule/games/{id}/record) lists EVERY player who appeared,
-- keyed by a stable Naver player id — so aggregating these across the season gives
-- true full rosters (the matchup engine needs 14 batters + rotation + bullpen/team).
--
-- One row per (game, player); the daily cron only fetches box scores for RESULT
-- games not already stored, so it stays incremental after the first backfill.
-- Public-read like the other stat tables; writes are service-role only.

-- Cheap incremental marker: set true once a game's box score is stored, so the
-- daily cron fetches only new games. Preserved across the daily games upsert
-- (that upsert never includes this column).
alter table public.kbo_games
  add column if not exists boxscore_ingested boolean not null default false;

create table if not exists public.kbo_boxscore_batters (
  game_id     text not null,
  player_id   text not null,
  season      integer not null,
  team        text,
  player_name text,
  bat_order   integer,
  pos         text,
  ab integer, hit integer, hr integer, bb integer, hbp integer,
  kk integer, sb integer, run integer, rbi integer,
  updated_at  timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index if not exists kbo_boxscore_batters_agg_idx
  on public.kbo_boxscore_batters (season, player_id);

create table if not exists public.kbo_boxscore_pitchers (
  game_id     text not null,
  player_id   text not null,
  season      integer not null,
  team        text,
  player_name text,
  started     boolean not null default false,
  ip numeric, bf integer, ab integer, hit integer, hr integer,
  r integer, er integer, bb integer, bbhp integer, kk integer,
  updated_at  timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index if not exists kbo_boxscore_pitchers_agg_idx
  on public.kbo_boxscore_pitchers (season, player_id);

alter table public.kbo_boxscore_batters  enable row level security;
alter table public.kbo_boxscore_pitchers enable row level security;

create policy "kbo_boxscore_batters: public read"  on public.kbo_boxscore_batters  for select using (true);
create policy "kbo_boxscore_pitchers: public read" on public.kbo_boxscore_pitchers for select using (true);

grant select on public.kbo_boxscore_batters, public.kbo_boxscore_pitchers to anon, authenticated;

-- Per-player season aggregates (the matchup builder reads these small views, not the
-- ~14k raw lines). security_invoker keeps base-table RLS in force; both are public.
create or replace view public.kbo_boxscore_batter_totals
  with (security_invoker = true) as
select season, player_id, team,
       max(player_name)            as player_name,
       count(*)                    as g,
       sum(ab) as ab, sum(hit) as hit, sum(hr) as hr, sum(bb) as bb,
       sum(kk) as kk, sum(sb) as sb, sum(run) as run, sum(rbi) as rbi
from public.kbo_boxscore_batters
group by season, player_id, team;

create or replace view public.kbo_boxscore_pitcher_totals
  with (security_invoker = true) as
select season, player_id, team,
       max(player_name)                       as player_name,
       count(*)                               as g,
       sum(case when started then 1 else 0 end) as gs,
       sum(ip) as ip, sum(bf) as bf, sum(hit) as hit, sum(hr) as hr,
       sum(r) as r, sum(er) as er, sum(bb) as bb, sum(bbhp) as bbhp, sum(kk) as kk
from public.kbo_boxscore_pitchers
group by season, player_id, team;

grant select on public.kbo_boxscore_batter_totals, public.kbo_boxscore_pitcher_totals
  to anon, authenticated;
