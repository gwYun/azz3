-- Favorite leagues + teams, synced per account (the web app keeps a device copy
-- in localStorage and mirrors it here when signed in — see web/lib/favorites.tsx).
--
-- One row per user. `leagues` = report-hub league ids ('kbo', 'epl', …);
-- `teams` = [{league, code, name}] (code = KBO franchise / Naver teamId, name =
-- display snapshot). The client sanitizes + caps both; the checks below are a
-- size backstop. Read/written directly by the signed-in user through RLS.

create table if not exists public.user_favorites (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  leagues    text[] not null default '{}',
  teams      jsonb  not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  check (cardinality(leagues) <= 20),
  check (jsonb_typeof(teams) = 'array' and jsonb_array_length(teams) <= 30)
);

alter table public.user_favorites enable row level security;

drop policy if exists "user_favorites select own" on public.user_favorites;
create policy "user_favorites select own" on public.user_favorites
  for select using (auth.uid() = user_id);

drop policy if exists "user_favorites insert own" on public.user_favorites;
create policy "user_favorites insert own" on public.user_favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_favorites update own" on public.user_favorites;
create policy "user_favorites update own" on public.user_favorites
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
