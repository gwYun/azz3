-- Credit (unlock voucher) model for per-item KBO prediction unlocks.
--
-- Users buy credits in bulk via Kakao Pay (bulk discount), then spend 1 credit
-- to unlock one matchup result (product = 'kbo:HOME-AWAY'). Credits are money —
-- all balance changes go through service-role-only atomic functions; clients
-- can READ their balance but can NEVER write it.

-- Balance on the profile; credits an order grants (0 for non-credit orders).
alter table public.profiles add column if not exists credits integer not null default 0
  check (credits >= 0);
alter table public.orders add column if not exists credits integer not null default 0
  check (credits >= 0);

-- SECURITY: drop the broad "update own profile" policy. With it, a user could
-- run `update profiles set credits = 999999 where id = me` straight from the
-- browser client. Balance changes now happen ONLY via the functions below.
drop policy if exists "profiles: update own" on public.profiles;

-- ---------------------------------------------------------------------------
-- add_credits: atomic increment. Called by the server after a verified payment.
-- ---------------------------------------------------------------------------
create or replace function public.add_credits(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_bal integer;
begin
  if p_amount <= 0 then
    raise exception 'add_credits: amount must be positive';
  end if;
  update public.profiles set credits = credits + p_amount
    where id = p_user_id
    returning credits into v_bal;
  return v_bal;
end;
$$;

-- ---------------------------------------------------------------------------
-- spend_credit_for_unlock: atomically spend 1 credit to grant an unlock.
--   'already'     → already unlocked, no charge (idempotent)
--   'insufficient'→ balance < 1
--   'no_profile'  → no profile row
--   'unlocked'    → 1 credit debited, entitlement granted
-- FOR UPDATE locks the balance row so two concurrent spends can't double-spend.
-- ---------------------------------------------------------------------------
create or replace function public.spend_credit_for_unlock(p_user_id uuid, p_product text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_bal integer;
begin
  if exists (
    select 1 from public.entitlements where user_id = p_user_id and product = p_product
  ) then
    return 'already';
  end if;

  select credits into v_bal from public.profiles where id = p_user_id for update;
  if v_bal is null then
    return 'no_profile';
  end if;
  if v_bal < 1 then
    return 'insufficient';
  end if;

  update public.profiles set credits = credits - 1 where id = p_user_id;
  insert into public.entitlements (user_id, product)
    values (p_user_id, p_product)
    on conflict (user_id, product) do nothing;
  return 'unlocked';
end;
$$;

-- Execute ONLY as the service role (the server admin client). Revoke the
-- default public grant so anon/authenticated clients can't call these via RPC
-- to mint credits or spend someone else's.
revoke all on function public.add_credits(uuid, integer) from public;
revoke all on function public.spend_credit_for_unlock(uuid, text) from public;
grant execute on function public.add_credits(uuid, integer) to service_role;
grant execute on function public.spend_credit_for_unlock(uuid, text) to service_role;
