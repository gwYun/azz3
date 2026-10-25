-- Beta: Kakao Pay removed, credits are charged free of charge, and every
-- account gets a one-time 10-credit sign-up gift (claimed from a first-login
-- popup → /credits). The orders/payments tables are left in place as history.

-- One-time gift flag. Existing accounts start unclaimed too, so everyone gets
-- the beta gift once.
alter table public.profiles
  add column if not exists signup_gift_claimed boolean not null default false;

-- ---------------------------------------------------------------------------
-- claim_signup_gift: atomically grant the gift once. Returns the new balance,
-- or NULL if already claimed. Creates the profile row if it's missing.
-- ---------------------------------------------------------------------------
create or replace function public.claim_signup_gift(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_bal integer;
begin
  if p_amount <= 0 then
    raise exception 'claim_signup_gift: amount must be positive';
  end if;
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;
  update public.profiles
    set credits = credits + p_amount, signup_gift_claimed = true
    where id = p_user_id and not signup_gift_claimed
    returning credits into v_bal;
  return v_bal;
end;
$$;

revoke all on function public.claim_signup_gift(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_signup_gift(uuid, integer) to service_role;
