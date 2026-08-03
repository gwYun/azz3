-- Phase 2: auth profile + payment/entitlement schema for Kakao Pay single payment.
--
-- Trust model:
--   profiles / entitlements / orders  → users may SELECT their own rows (RLS).
--   payments                          → NO client access at all; server (service
--                                        role, which bypasses RLS) only.
--   All writes to entitlements/orders/payments happen server-side via the
--   service-role client (web/lib/supabase/admin.ts). Clients never write money.

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users. Identity keys on the Kakao provider sub.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  kakao_sub  text,
  nickname   text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- entitlements: what a user has unlocked (e.g. 'premium'). Granted ONLY by the
-- server after a verified payment. unique(user_id, product) makes granting
-- idempotent. Users read their own; no client write policy exists.
-- ---------------------------------------------------------------------------
create table if not exists public.entitlements (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  product           text not null,
  granted_at        timestamptz not null default now(),
  source_payment_id uuid,
  unique (user_id, product)
);
alter table public.entitlements enable row level security;

create policy "entitlements: select own" on public.entitlements
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- orders: a purchase intent. Created server-side; user reads own.
-- amount is integer KRW (won has no minor unit).
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  product    text not null,
  amount     integer not null check (amount > 0),
  currency   text not null default 'KRW',
  status     text not null default 'pending'
             check (status in ('pending', 'ready', 'approved', 'failed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders enable row level security;

create policy "orders: select own" on public.orders
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- payments: provider-side record. NEVER client-accessible (no RLS policies →
-- only the service role, which bypasses RLS, can read/write).
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  provider        text not null default 'kakaopay',
  kakao_tid       text,
  status          text not null default 'ready'
                  check (status in ('ready', 'approved', 'failed', 'canceled')),
  approved_amount integer,
  pg_token        text,
  raw_response    jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.payments enable row level security;
-- (intentionally no policies)

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Create a profile row when a new auth user signs up. security definer so it
-- can insert past RLS; search_path pinned per Supabase lint guidance.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, kakao_sub, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub'),
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'nickname')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
