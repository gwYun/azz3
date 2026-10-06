-- Soccer match prediction + per-team match reports.
--
-- Builds on 20260827120000_soccer_daily_stats.sql (games / standings / players).
-- The model (python/soccer/apps/league_predict, ported to web/lib/soccer/
-- match-model.ts) is a VALUE-driven Poisson: each club's pre-season squad value
-- rating sets its prior strength, and results refine it (big-5 = "hybrid";
-- K League has no value data → "results" only).
--
--   soccer_club_ratings      pre-season value rating per club-season (Python,
--                            once per season). PUBLIC read — it's a squad-value
--                            index, not the paid forecast.
--   soccer_match_predictions our pre-kickoff 1X2 / expected goals per game,
--                            FROZEN at kickoff (the cron only writes games that
--                            have not started), so a review can honestly compare
--                            prediction vs result. SERVICE-ROLE ONLY: the
--                            probabilities are the paid content of the reports.
--   soccer_articles          one report per team, published the day after each
--                            of its matches (review of that match + preview of
--                            the next). HARD paywall exactly like kbo_articles:
--                            RLS on, NO policy; reads go through server routes
--                            that enforce the time-lock (the newest 1 article per
--                            team is paid, older ones are free).
--
-- Naming principle: league and season are columns, never baked into table names.

create table if not exists public.soccer_club_ratings (
  league        text not null,
  season        integer not null,
  team_code     text not null,
  rating        numeric not null,            -- z-score of log(synergy strength) within league-season
  strength      numeric,                     -- synergy-adjusted squad value (EUR, 2022-€ scale)
  synergy_mult  numeric,
  known_share   numeric,                     -- share of roster with a chained value (rest = median)
  model_commit  text,
  computed_at   timestamptz not null default now(),
  primary key (league, season, team_code)
);

create table if not exists public.soccer_match_predictions (
  game_id       text primary key,            -- soccer_games.game_id
  league        text not null,
  season        integer not null,
  game_date     date not null,
  kickoff       timestamptz,
  home_team     text not null,
  away_team     text not null,
  model         text not null,               -- 'hybrid' | 'results' (+ version tag)
  p_home        numeric not null,            -- 0–1
  p_draw        numeric not null,
  p_away        numeric not null,
  xg_home       numeric not null,            -- model expected goals (Poisson λ)
  xg_away       numeric not null,
  top_score     text,                        -- most likely scoreline, e.g. '1-0'
  predicted_at  timestamptz not null default now()
);
create index if not exists soccer_match_predictions_league_date_idx
  on public.soccer_match_predictions (league, game_date);

create table if not exists public.soccer_articles (
  id              uuid primary key default gen_random_uuid(),
  league          text not null,
  season          integer not null,
  team            text not null,             -- Naver team code (per league)
  article_date    date not null,             -- KST publish date (day after the match)
  review_game_id  text not null,             -- the match this report reviews
  next_game_id    text,                      -- the match it previews (null if none scheduled)
  title           text not null,
  dek             text not null,
  teaser          jsonb not null default '{}'::jsonb,   -- public above-the-fold facts
  body_html       text not null,                        -- the GATED full report
  brief           jsonb not null default '{}'::jsonb,   -- deterministic data brief (provenance + trend)
  model           text,                                 -- prose model id or 'template'
  run_id          text,
  published_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (league, team, article_date),
  unique (league, team, review_game_id)
);
create index if not exists soccer_articles_team_recent
  on public.soccer_articles (league, team, article_date desc);
create index if not exists soccer_articles_league_recent
  on public.soccer_articles (league, article_date desc);

alter table public.soccer_club_ratings       enable row level security;
alter table public.soccer_match_predictions  enable row level security;
alter table public.soccer_articles           enable row level security;

create policy "soccer_club_ratings: public read" on public.soccer_club_ratings for select using (true);
grant select on public.soccer_club_ratings to anon, authenticated;
-- soccer_match_predictions, soccer_articles: intentionally NO policy → service role only.
