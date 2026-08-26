-- Daily KBO team articles — one newspaper-style column per team per day, written
-- by the nightly cron (/api/cron/kbo-daily) from the fresh sim + standings.
--
-- MONETIZATION: the 3 most-recent articles per team are paid (spend 1 credit to
-- unlock, product key `kbo:article:<TEAM>:<DATE>`); everything older is free. The
-- lock is time-based and computed server-side (see web/lib/credits.ts).
--
-- HARD PAYWALL: unlike the matchup gate (soft — the sim runs client-side, values
-- sit in the DOM under a blur), the article body is server-generated, so we keep
-- it off the public REST surface entirely. RLS is enabled with NO read policy →
-- neither anon nor authenticated clients can SELECT this table. Every read goes
-- through a server route on the service-role admin client, which enforces
-- age/entitlement (web/app/api/kbo/article/[team]/[date]/route.ts). A body column
-- that were public-read would make the paywall trivially bypassable.
--
-- Naming principle (PROJECT_KNOWLEDGE.md): season is a column, not baked into the
-- table name — 2027 is new rows, not a new table.

create table if not exists public.kbo_articles (
  id            uuid primary key default gen_random_uuid(),
  season        int  not null,
  team          text not null,              -- franchise code (SS/LG/KT/HT/OB/HH/NC/LT/SK/WO)
  article_date  date not null,
  title         text not null,
  dek           text not null,             -- subtitle / teaser summary (safe to expose)
  teaser        jsonb not null default '{}'::jsonb, -- above-the-fold chips/numbers shown unblurred
  body_html     text not null,             -- the GATED full article
  brief         jsonb not null default '{}'::jsonb, -- deterministic data brief used to generate (provenance + trend)
  model         text,                      -- prose model id, or 'template' for the deterministic fallback
  run_id        text,
  published_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (season, team, article_date)
);

-- Ranking index for the "3 most-recent per team" lock and the news index.
create index if not exists kbo_articles_team_recent
  on public.kbo_articles (season, team, article_date desc);
create index if not exists kbo_articles_recent
  on public.kbo_articles (season, article_date desc);

-- RLS on, NO policies → service-role-only (hard paywall; see header).
alter table public.kbo_articles enable row level security;
