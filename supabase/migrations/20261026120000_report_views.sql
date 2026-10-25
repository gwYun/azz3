-- View counts on every report (KBO daily, KBO postseason, soccer), for the
-- report lists' default "most viewed" sort. Bumped by /api/views (service role)
-- through an atomic RPC; the client dedupes to one view per report per day.
-- Run after 20261015120000_report_replies.sql.

alter table public.kbo_articles            add column if not exists view_count int not null default 0;
alter table public.kbo_postseason_articles add column if not exists view_count int not null default 0;
alter table public.soccer_articles         add column if not exists view_count int not null default 0;

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
  end if;
end;
$$;

revoke all on function public.increment_report_view(text, uuid) from public, anon, authenticated;
grant execute on function public.increment_report_view(text, uuid) to service_role;
