-- Soccer daily-refresh data layer.
--
-- Sibling of the KBO pipeline (kbo_* tables): a nightly Vercel cron
-- (/api/cron/soccer-daily) pulls robots-clean Naver Sports football feeds and
-- lands scores, standings, and player stats for the major leagues so the web
-- app can serve fresh numbers WITHOUT a redeploy. Source + endpoint catalog:
-- web/lib/soccer/naver.ts and the soccer-naver-endpoints memory.
--
-- Trust model (same as KBO): every table here is PUBLIC, read-only football
-- data. RLS on + a permissive SELECT policy for anon/authenticated, and NO write
-- policy — all writes go through the service-role client (web/lib/supabase/
-- admin.ts) inside the cron route, which bypasses RLS. Clients read; only the
-- server writes. soccer_ingest_runs stays server-only (can leak upstream errors).
--
-- Naming: `league` and `season` are COLUMNS, never baked into a table name, so a
-- new league or a new season is new rows, not a new schema. league ∈
-- {epl, primera, bundesliga, seria, ligue1, kleague, kleague2} (Naver categoryId).
-- season = the season's START year as an int (EPL 2026 = 2026/27; K League 2026 =
-- the 2026 calendar season). Team codes are Naver's opaque per-league team ids.
--
-- "Gather every possible data": each stats table keeps the important queryable
-- fields as typed columns AND a `raw` jsonb of the full Naver row, so nothing the
-- feed carries is lost even before we model a column for it.

-- ---------------------------------------------------------------------------
-- soccer_teams — team registry, one row per (league, team_code). Populated from
-- the games + standings feeds; carries display names + emblem for the UI.
-- ---------------------------------------------------------------------------
create table if not exists public.soccer_teams (
  league      text not null,
  team_code   text not null,                 -- Naver teamId (opaque, per-league)
  name        text,                           -- full Korean name (e.g. '브라이턴 앤 호브')
  short_name  text,                           -- '브라이턴'
  keyword     text,                           -- official/searchable name ('브라이턴 앤 호브 알비온 FC')
  emblem_url  text,
  updated_at  timestamptz not null default now(),
  primary key (league, team_code)
);

-- ---------------------------------------------------------------------------
-- soccer_games — one row per match (일정·스코어). Source: Naver schedule/games.
-- game_id is Naver's opaque gameId; team codes reference soccer_teams.team_code.
-- ---------------------------------------------------------------------------
create table if not exists public.soccer_games (
  game_id        text primary key,
  league         text not null,
  season         integer not null,
  game_date      date not null,
  kickoff        timestamptz,                 -- gameDateTime (KST-based)
  status         text not null,               -- RESULT | BEFORE | STARTED | CANCEL | ...
  round          text,                        -- matchday / round label if present
  home_team      text not null,               -- Naver team code
  away_team      text not null,
  home_name      text,                        -- denormalized for convenience
  away_name      text,
  home_score     integer,
  away_score     integer,
  winner         text,                        -- HOME | AWAY | null (draw / not played)
  cancel         boolean not null default false,
  suspended      boolean not null default false,
  updated_at     timestamptz not null default now()
);
create index if not exists soccer_games_league_season_date_idx on public.soccer_games (league, season, game_date);
create index if not exists soccer_games_league_season_status_idx on public.soccer_games (league, season, status);

-- ---------------------------------------------------------------------------
-- soccer_standings — one row per (league, season, team). Source: Naver
-- statistics/.../teams. Rich team-season stats (points/GF/GA + xG, possession,
-- shots, passing, cards). Naver's OWN forecast (rankPrediction +
-- finalRankDistribution) is kept in naver_pred jsonb as a cross-check only —
-- never the served number (same principle as KBO's naver_* columns). raw holds
-- the full row so no field is dropped.
-- ---------------------------------------------------------------------------
create table if not exists public.soccer_standings (
  league        text not null,
  season        integer not null,
  team_code     text not null,
  rank          integer,
  rank_status   text,                          -- 'UEFA Champions League' / relegation zone / null
  matches       integer,
  wins          integer,
  draws         integer,
  losses        integer,
  points        integer,
  goals_for     integer,
  goals_against integer,
  goal_diff     integer,
  xg            numeric,                        -- expectedGoals
  xga           numeric,                        -- expectedGoalsConceded
  possession    numeric,
  shots         integer,
  shots_on_target integer,
  passes        integer,
  pass_accuracy numeric,
  corners       integer,
  fouls         integer,
  yellow_cards  integer,
  red_cards     integer,
  clean_sheets  integer,
  last_five     text,                           -- 'WWLDW'
  naver_pred    jsonb,                          -- Naver's rankPrediction + finalRankDistribution (cross-check)
  raw           jsonb,                          -- full Naver seasonTeamStats row
  updated_at    timestamptz not null default now(),
  primary key (league, season, team_code)
);

-- ---------------------------------------------------------------------------
-- soccer_player_stats — one row per (league, season, player). Source: Naver
-- statistics/.../players (paginated for full coverage). Counting + rate stats;
-- raw jsonb keeps the complete row.
-- ---------------------------------------------------------------------------
create table if not exists public.soccer_player_stats (
  league        text not null,
  season        integer not null,
  player_id     text not null,
  player_name   text,
  short_name    text,
  team_code     text,
  position      text,                           -- GK | DF | MF | FW
  back_number   text,
  country_id    text,
  matches       integer,
  starts        integer,
  minutes       integer,
  goals         integer,
  assists       integer,
  xg            numeric,                         -- expectedGoals
  xa            numeric,                         -- expectedAssists
  shots         integer,
  shots_on_target integer,
  key_passes    integer,
  passes        integer,
  pass_accuracy numeric,
  yellow_cards  integer,
  red_cards     integer,
  saves         integer,
  clean_sheets  integer,
  goals_conceded integer,
  index_score   numeric,                         -- Naver player rating
  raw           jsonb,                           -- full Naver seasonPlayerStats row
  updated_at    timestamptz not null default now(),
  primary key (league, season, player_id)
);
create index if not exists soccer_player_stats_team_idx on public.soccer_player_stats (league, season, team_code);

-- ---------------------------------------------------------------------------
-- soccer_sim_snapshots — latest OUR-model output, one row per (league, season,
-- kind). Parity with kbo_sim_snapshots; not yet populated (the sim comes after
-- the data layer). kind is open text so 'season' / 'matchup' / etc. can be added.
-- ---------------------------------------------------------------------------
create table if not exists public.soccer_sim_snapshots (
  league       text not null,
  season       integer not null,
  kind         text not null,
  payload      jsonb not null,
  run_id       text,
  model_commit text,
  sims         integer,
  generated_at timestamptz not null default now(),
  primary key (league, season, kind)
);

-- ---------------------------------------------------------------------------
-- soccer_ingest_runs — observability for the scheduled job. NOT public.
-- ---------------------------------------------------------------------------
create table if not exists public.soccer_ingest_runs (
  id                bigint generated always as identity primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running'
                    check (status in ('running', 'success', 'error')),
  season            integer,
  trigger           text,                        -- 'cron' | 'manual'
  leagues           text[],                      -- leagues touched this run
  games_upserted    integer,
  standings_upserted integer,
  players_upserted  integer,
  error             text,
  detail            jsonb
);
create index if not exists soccer_ingest_runs_started_idx on public.soccer_ingest_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- RLS: public read for the data tables; ingest log stays server-only.
-- ---------------------------------------------------------------------------
alter table public.soccer_teams          enable row level security;
alter table public.soccer_games          enable row level security;
alter table public.soccer_standings      enable row level security;
alter table public.soccer_player_stats   enable row level security;
alter table public.soccer_sim_snapshots  enable row level security;
alter table public.soccer_ingest_runs    enable row level security;

create policy "soccer_teams: public read"         on public.soccer_teams         for select using (true);
create policy "soccer_games: public read"         on public.soccer_games         for select using (true);
create policy "soccer_standings: public read"     on public.soccer_standings     for select using (true);
create policy "soccer_player_stats: public read"  on public.soccer_player_stats  for select using (true);
create policy "soccer_sim_snapshots: public read" on public.soccer_sim_snapshots for select using (true);
-- soccer_ingest_runs: intentionally NO policy → only the service role can read/write.

grant select on public.soccer_teams,
                public.soccer_games,
                public.soccer_standings,
                public.soccer_player_stats,
                public.soccer_sim_snapshots
  to anon, authenticated;
