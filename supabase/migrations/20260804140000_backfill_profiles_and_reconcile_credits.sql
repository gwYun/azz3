-- Fix: users who signed up BEFORE the handle_new_user trigger (Phase 1 testers)
-- have no profiles row. add_credits did `update profiles ... where id = user`,
-- which updated 0 rows and silently dropped their paid credits.
--
-- 1) backfill a profile for every auth user missing one
-- 2) make add_credits create-on-missing (upsert) so it can never silently no-op
-- 3) one-time reconcile: grant credits for already-approved credit orders

-- 1. Backfill.
insert into public.profiles (id, kakao_sub, nickname)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'provider_id', u.raw_user_meta_data ->> 'sub'),
  coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'nickname')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 2. add_credits upserts the balance (creates the profile row if absent).
create or replace function public.add_credits(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_bal integer;
begin
  if p_amount <= 0 then
    raise exception 'add_credits: amount must be positive';
  end if;
  insert into public.profiles (id, credits)
    values (p_user_id, p_amount)
    on conflict (id) do update set credits = public.profiles.credits + excluded.credits
    returning credits into v_bal;
  return v_bal;
end;
$$;

-- Re-assert execute grants (CREATE OR REPLACE preserves them, but be explicit).
revoke all on function public.add_credits(uuid, integer) from public;
grant execute on function public.add_credits(uuid, integer) to service_role;

-- 3. One-time reconcile: credit each user the sum of their approved credit
--    orders. Guarded on credits = 0 so anyone already credited isn't doubled.
update public.profiles p
set credits = p.credits + o.total
from (
  select user_id, sum(credits) as total
  from public.orders
  where status = 'approved' and credits > 0
  group by user_id
) o
where o.user_id = p.id and p.credits = 0;
