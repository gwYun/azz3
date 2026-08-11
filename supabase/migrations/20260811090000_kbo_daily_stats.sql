-- KBO daily-refresh data layer.
--
-- Feeds the nightly Vercel cron (/api/cron/kbo-daily) that pulls robots-clean
-- Naver Sports stats and recomputes the 2026 forecast. These tables are the
-- delivery layer: the web app reads them so refreshed numbers reach users
-- WITHOUT a redeploy (the old flow committed static kbo.json into the repo).
--
-- Trust model: every table here is PUBLIC, read-only baseball stats (same data
-- the app already served as /kbo.json). So: RLS on + a permissive SELECT policy
-- for anon/authenticated, and NO write policy — all writes go through the
-- service-role client (web/lib/supabase/admin.ts) inside the cron route, which
-- bypasses RLS. Clients can read the numbers; only the server can write them.
--
-- Naming: tables carry a `season` column (PK includes it) instead of baking the
-- year into the table name, so 2027 is a new set of rows, not a new schema. The
-- "2026 stats" the user asked for live here as season = 2026.

-- ---------------------------------------------------------------------------
-- kbo_games — one row per game (매치·득점). Source: Naver schedule/games.
-- game_id is Naver's gameId (e.g. '20260801HHKT02026'); team codes are the
-- project's franchise codes (SS, LG, KT, HT, OB, HH, NC, LT, SK, WO).
-- ---------------------------------------------------------------------------
create table if not exists public.kbo_games (
  game_id    text primary key,
  season     integer not null,
  game_date  date not null,
  status     text not null,                 -- RESULT | BEFORE | STARTED | CANCEL | ...
  stadium    text,
  away_team  text not null,
  home_team  text not null,
  away_score integer,
  home_score integer,
  winner     text,                          -- HOME | AWAY | null (draw / not played)
  cancel     boolean not null default false,
  suspended  boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists kbo_games_season_date_idx on public.kbo_games (season, game_date);
create index if not exists kbo_games_status_idx on public.kbo_games (season, status);

-- ---------------------------------------------------------------------------
-- kbo_team_stats — one row per team-season (팀 통계 + 순위). Source: Naver
-- statistics/.../teams. Naver splits BB and HBP null but always fills the
-- combined bbhp, so we store bbhp (offense + defense) as the walk+hbp total.
-- ---------------------------------------------------------------------------
create table if not exists public.kbo_team_stats (
  season      integer not null,
  team        text not null,
  ranking     integer,
  games       integer,
  win         integer,
  lose        integer,
  draw        integer,
  wra         numeric,                       -- win rate (ties excluded)
  game_behind numeric,
  last_five   text,                          -- e.g. 'WWLWL'
  streak      text,                          -- e.g. '7승'
  -- offense (per-season totals)
  o_run  integer, o_rbi integer, o_ab integer, o_hit integer,
  o_h2   integer, o_h3  integer, o_hr integer, o_sb  integer,
  o_bbhp integer, o_kk  integer,
  o_obp  numeric, o_slg numeric, o_ops numeric, o_hra numeric,
  -- run prevention (per-season totals)
  d_era    numeric, d_r integer, d_er integer, d_inning numeric,
  d_hit    integer, d_hr integer, d_kk integer, d_bbhp integer,
  d_err    integer, d_whip numeric, d_qs integer, d_save integer, d_hold integer,
  updated_at timestamptz not null default now(),
  primary key (season, team)
);

-- ---------------------------------------------------------------------------
-- kbo_hitter_stats — one row per hitter-season (선수 통계, 타자). Raw counting
-- stats come from Naver; the advanced metrics (obp/slg/woba/wrc_plus/war) are
-- recomputed IN-HOUSE from the raw counts (kbo/src/sabermetrics.py ported to
-- web/lib/kbo). Naver's own published numbers are kept in naver_* columns as a
-- cross-check only — never as the served value (project methodology principle).
-- ---------------------------------------------------------------------------
create table if not exists public.kbo_hitter_stats (
  player_id  text not null,
  season     integer not null,
  player_name text,
  team       text,
  -- raw counts (Naver)
  games integer, ab integer, hit integer, h2 integer, h3 integer, hr integer,
  bb integer, hp integer, kk integer, sb integer, cs integer,
  rbi integer, run integer, gd integer,
  -- computed in-house
  obp numeric, slg numeric, ops numeric,
  woba numeric, wrc_plus numeric, war numeric,
  -- Naver published (cross-check)
  naver_woba numeric, naver_wrc_plus numeric, naver_war numeric,
  is_qualified boolean,
  source     text not null default 'naver_players',   -- naver_players | boxscore
  updated_at timestamptz not null default now(),
  primary key (player_id, season)
);
create index if not exists kbo_hitter_stats_team_idx on public.kbo_hitter_stats (season, team);

-- ---------------------------------------------------------------------------
-- kbo_pitcher_stats — one row per pitcher-season (선수 통계, 투수). Same
-- in-house-recompute contract as hitters: era/whip/fip/war computed here from
-- the raw counts; naver_* are cross-check columns.
-- ---------------------------------------------------------------------------
create table if not exists public.kbo_pitcher_stats (
  player_id  text not null,
  season     integer not null,
  player_name text,
  team       text,
  -- raw counts (Naver)
  games integer, gs integer, inning numeric, bf integer,
  hit integer, hr integer, r integer, er integer,
  bb integer, hp integer, kk integer,
  win integer, lose integer, save integer, hold integer, qs integer,
  pitch_count integer,
  -- computed in-house
  era numeric, whip numeric, fip numeric, war numeric,
  -- Naver published (cross-check)
  naver_era numeric, naver_war numeric,
  is_qualified boolean,
  source     text not null default 'naver_players',
  updated_at timestamptz not null default now(),
  primary key (player_id, season)
);
create index if not exists kbo_pitcher_stats_team_idx on public.kbo_pitcher_stats (season, team);

-- ---------------------------------------------------------------------------
-- kbo_sim_snapshots — latest simulation output, one row per (season, kind).
-- kind = 'season'  → the kbo.json-shaped standings + championship odds payload.
-- kind = 'matchup' → the kbo-matchup.json-shaped per-player engine ingredients.
-- Upsert on (season, kind) keeps exactly the latest run; provenance in run_id /
-- model_commit / sims. The web reads payload directly (P4).
-- ---------------------------------------------------------------------------
create table if not exists public.kbo_sim_snapshots (
  season       integer not null,
  kind         text not null check (kind in ('season', 'matchup')),
  payload      jsonb not null,
  run_id       text,
  model_commit text,
  sims         integer,
  generated_at timestamptz not null default now(),
  primary key (season, kind)
);

-- ---------------------------------------------------------------------------
-- kbo_ingest_runs — observability for the scheduled job. One row per cron run:
-- when it ran, what it touched, and any error. NOT public (no policy → service
-- role only); it can leak upstream error text and run internals.
-- ---------------------------------------------------------------------------
create table if not exists public.kbo_ingest_runs (
  id                bigint generated always as identity primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running'
                    check (status in ('running', 'success', 'error')),
  season            integer,
  trigger           text,                   -- 'cron' | 'manual'
  games_upserted    integer,
  hitters_upserted  integer,
  pitchers_upserted integer,
  error             text,
  detail            jsonb
);
create index if not exists kbo_ingest_runs_started_idx on public.kbo_ingest_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- RLS: public read for the five stat tables; ingest log stays server-only.
-- ---------------------------------------------------------------------------
alter table public.kbo_games          enable row level security;
alter table public.kbo_team_stats     enable row level security;
alter table public.kbo_hitter_stats   enable row level security;
alter table public.kbo_pitcher_stats  enable row level security;
alter table public.kbo_sim_snapshots  enable row level security;
alter table public.kbo_ingest_runs    enable row level security;

create policy "kbo_games: public read"         on public.kbo_games         for select using (true);
create policy "kbo_team_stats: public read"    on public.kbo_team_stats    for select using (true);
create policy "kbo_hitter_stats: public read"  on public.kbo_hitter_stats  for select using (true);
create policy "kbo_pitcher_stats: public read" on public.kbo_pitcher_stats for select using (true);
create policy "kbo_sim_snapshots: public read" on public.kbo_sim_snapshots for select using (true);
-- kbo_ingest_runs: intentionally NO policy → only the service role can read/write.

-- Be explicit about table-level grants for the anon/authenticated API roles
-- (RLS governs rows; the role still needs SELECT on the table). Writes are
-- never granted — the service role bypasses both grants and RLS.
grant select on public.kbo_games,
                public.kbo_team_stats,
                public.kbo_hitter_stats,
                public.kbo_pitcher_stats,
                public.kbo_sim_snapshots
  to anon, authenticated;
