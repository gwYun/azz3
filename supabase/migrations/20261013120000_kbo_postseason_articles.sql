-- KBO postseason series reports — one report per SERIES per game day (plus a
-- wrap-up the morning after a series is decided), written by the 05:00 KST
-- /api/cron/kbo-daily run from the conditional postseason sim
-- (web/lib/kbo/postseason-sim.ts).
--
-- round ∈ {WC, SPO, PO, KS} (와일드카드 결정전 · 준플레이오프 · 플레이오프 · 한국시리즈),
-- matching Naver's postseason gameId prefixes 4444 / 3333 / 5555 / 7777.
--
-- MONETIZATION: the newest report of each series is paid (1 credit, product key
-- `kbo:postseason:<season>:<round>:<date>`); older ones are free. Same HARD
-- paywall as kbo_articles / soccer_articles: RLS on, NO policy → service-role
-- only; reads go through server routes that enforce the time-lock. The
-- postseason probabilities live only here (brief + body), never in a public table.

create table if not exists public.kbo_postseason_articles (
  id            uuid primary key default gen_random_uuid(),
  season        int  not null,
  round         text not null check (round in ('WC', 'SPO', 'PO', 'KS')),
  article_date  date not null,              -- KST publish date
  higher_team   text not null,              -- higher seed (franchise code)
  lower_team    text not null,
  review_game_id text,                      -- yesterday's game of this series (null on day 1)
  today_game_id  text,                      -- today's game (null on a wrap-up day)
  title         text not null,
  dek           text not null,
  teaser        jsonb not null default '{}'::jsonb,
  body_html     text not null,
  brief         jsonb not null default '{}'::jsonb,   -- includes today's pre-game prediction (frozen record)
  model         text,
  run_id        text,
  published_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (season, round, article_date)
);

create index if not exists kbo_postseason_articles_recent
  on public.kbo_postseason_articles (season, round, article_date desc);

alter table public.kbo_postseason_articles enable row level security;
-- intentionally NO policy → service role only (hard paywall).
