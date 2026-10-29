-- LoL Worlds (롤드컵) predictions + daily reports.
--
-- lol_matches      every SERIES Naver's esports schedule lists for the leagues in
--                  web/lib/lol/leagues.ts (domestic leagues train the rating model;
--                  world_championship is the event we predict). Scores are MAP wins.
-- lol_predictions  pre-match series odds for Worlds matches, rewritten on every
--                  cron run until the series starts, then never touched again →
--                  each row is FROZEN at its last pre-start prediction.
-- lol_articles     one Worlds report per MATCH DAY (KST), published as soon as the
--                  day's last series is final (the cron runs through the morning):
--                  review of that day vs the frozen predictions + preview of the
--                  next match day + Swiss/knockout odds from the conditional sim.
--
-- MONETIZATION: the newest report is paid (1 credit, product key
-- `lol:worlds:<season>:<date>`); older ones are free. Same HARD paywall as the
-- other report tables: RLS on, NO policy → service-role only. lol_predictions
-- is likewise service-role only (the odds are the paid content).

create table if not exists public.lol_matches (
  game_id     text primary key,
  top_league  text not null,                 -- Naver topLeagueId ('lck', 'world_championship', …)
  league_id   text not null,                 -- Naver leagueId ('world_championship_2026')
  start_at    timestamptz not null,
  title       text,                          -- '스위스 3R', '8강', …
  status      text not null,                 -- RESULT | BEFORE | STARTED
  best_of     int  not null,
  home_team   text not null,                 -- Naver teamId; 'TBD' until drawn
  away_team   text not null,
  home_name   text,
  away_name   text,
  home_code   text,                          -- English acronym (GEN, T1, …)
  away_code   text,
  home_score  int  not null default 0,       -- maps won
  away_score  int  not null default 0,
  stadium     text,
  raw         jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists lol_matches_league_start on public.lol_matches (league_id, start_at);
create index if not exists lol_matches_start on public.lol_matches (start_at);
alter table public.lol_matches enable row level security;
-- No policy: read through server routes only.

create table if not exists public.lol_predictions (
  game_id     text primary key references public.lol_matches(game_id) on delete cascade,
  league_id   text not null,
  start_at    timestamptz not null,
  home_team   text not null,
  away_team   text not null,
  best_of     int  not null,
  p_map       double precision not null,     -- P(home wins one map)
  p_home      double precision not null,     -- P(home wins the series)
  scores      jsonb not null,                -- [{a,b,p}] exact series-score distribution (home = a)
  model       text not null,
  predicted_at timestamptz not null default now()
);
alter table public.lol_predictions enable row level security;

create table if not exists public.lol_articles (
  id            uuid primary key default gen_random_uuid(),
  season        int  not null,
  event         text not null default 'worlds',
  article_date  date not null,               -- the MATCH DAY reviewed (KST)
  teams         text[] not null default '{}', -- acronyms of every team in review + preview (hub filter)
  title         text not null,
  dek           text not null,
  teaser        jsonb not null default '{}'::jsonb,
  body_html     text not null,
  brief         jsonb not null default '{}'::jsonb,
  model         text,
  run_id        text,
  reply_count   int  not null default 0,
  view_count    int  not null default 0,
  published_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (season, event, article_date)
);
create index if not exists lol_articles_recent on public.lol_articles (season, event, article_date desc);
alter table public.lol_articles enable row level security;
-- intentionally NO policy → service role only (hard paywall).

-- Replies + views: a 4th report kind ('lol').
alter table public.report_replies add column if not exists lol_article_id uuid references public.lol_articles(id) on delete cascade;
alter table public.report_replies drop constraint if exists report_replies_check;
alter table public.report_replies add constraint report_replies_check
  check (num_nonnulls(kbo_article_id, kbo_postseason_id, soccer_article_id, lol_article_id) = 1);
create index if not exists report_replies_lol_idx
  on public.report_replies (lol_article_id, created_at) where lol_article_id is not null and deleted_at is null;

create or replace function public.report_replies_bump_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta int := 0;
  r public.report_replies;
begin
  if tg_op = 'INSERT' then
    r := new;
    if new.deleted_at is null then delta := 1; end if;
  elsif tg_op = 'UPDATE' then
    r := new;
    if old.deleted_at is null and new.deleted_at is not null then delta := -1;
    elsif old.deleted_at is not null and new.deleted_at is null then delta := 1;
    end if;
  else
    r := old;
    if old.deleted_at is null then delta := -1; end if;
  end if;

  if delta = 0 then return null; end if;

  if r.kbo_article_id is not null then
    update public.kbo_articles set reply_count = greatest(reply_count + delta, 0) where id = r.kbo_article_id;
  elsif r.kbo_postseason_id is not null then
    update public.kbo_postseason_articles set reply_count = greatest(reply_count + delta, 0) where id = r.kbo_postseason_id;
  elsif r.soccer_article_id is not null then
    update public.soccer_articles set reply_count = greatest(reply_count + delta, 0) where id = r.soccer_article_id;
  elsif r.lol_article_id is not null then
    update public.lol_articles set reply_count = greatest(reply_count + delta, 0) where id = r.lol_article_id;
  end if;
  return null;
end;
$$;

create or replace function public.increment_report_view(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'kbo-daily' then
    update public.kbo_articles set view_count = view_count + 1 where id = p_id;
  elsif p_kind = 'kbo-postseason' then
    update public.kbo_postseason_articles set view_count = view_count + 1 where id = p_id;
  elsif p_kind = 'soccer' then
    update public.soccer_articles set view_count = view_count + 1 where id = p_id;
  elsif p_kind = 'lol' then
    update public.lol_articles set view_count = view_count + 1 where id = p_id;
  end if;
end;
$$;

revoke all on function public.increment_report_view(text, uuid) from public, anon, authenticated;
grant execute on function public.increment_report_view(text, uuid) to service_role;
