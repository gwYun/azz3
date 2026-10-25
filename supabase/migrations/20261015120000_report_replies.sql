-- Reader replies on every report (KBO daily, KBO postseason, soccer).
--
-- One table, three nullable FKs (exactly one set) so each reply has real
-- referential integrity and cascades away with its report. Service-role only
-- (RLS on, no policies): reads/writes go through /api/replies, which checks
-- login + paywall access. Soft delete via deleted_at.
--
-- reply_count on each report table is a denormalized counter kept by trigger,
-- so the list endpoints can show counts (incl. locked reports) without a
-- per-request aggregate. Report generators upsert on natural keys without `id`
-- or `reply_count`, so both survive regeneration.

create table if not exists public.report_replies (
  id uuid primary key default gen_random_uuid(),
  kbo_article_id    uuid references public.kbo_articles(id) on delete cascade,
  kbo_postseason_id uuid references public.kbo_postseason_articles(id) on delete cascade,
  soccer_article_id uuid references public.soccer_articles(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (num_nonnulls(kbo_article_id, kbo_postseason_id, soccer_article_id) = 1)
);

create index if not exists report_replies_kbo_idx
  on public.report_replies (kbo_article_id, created_at) where kbo_article_id is not null and deleted_at is null;
create index if not exists report_replies_ps_idx
  on public.report_replies (kbo_postseason_id, created_at) where kbo_postseason_id is not null and deleted_at is null;
create index if not exists report_replies_soccer_idx
  on public.report_replies (soccer_article_id, created_at) where soccer_article_id is not null and deleted_at is null;
-- Rate limit lookups (recent replies by user).
create index if not exists report_replies_user_idx on public.report_replies (user_id, created_at desc);

alter table public.report_replies enable row level security;

alter table public.kbo_articles            add column if not exists reply_count int not null default 0;
alter table public.kbo_postseason_articles add column if not exists reply_count int not null default 0;
alter table public.soccer_articles         add column if not exists reply_count int not null default 0;

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
  else -- DELETE (user cascade, or report cascade where the parent is gone anyway)
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
  end if;
  return null;
end;
$$;

revoke all on function public.report_replies_bump_count() from public, anon, authenticated;

drop trigger if exists report_replies_count on public.report_replies;
create trigger report_replies_count
  after insert or update of deleted_at or delete on public.report_replies
  for each row execute function public.report_replies_bump_count();
