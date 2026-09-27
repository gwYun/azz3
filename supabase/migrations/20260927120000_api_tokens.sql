-- Open API access tokens — machine credentials for the read-only /api/v1 news API.
--
-- WHY: a teammate's Claude bot pulls daily-news content (KBO article bodies +
-- soccer daily data) to generate card news. That is a TRUSTED, non-paying channel
-- that must bypass the consumer paywall, so it can't ride the Supabase session /
-- credit system. Instead each consumer gets a bearer token, issued by an admin
-- (web/app/api/admin/tokens + /admin/tokens UI) and checked on every request
-- (web/lib/api-auth/token.ts).
--
-- SECURITY (same hard-wall posture as kbo_articles):
--   * Only the SHA-256 HASH of a token is stored. The plaintext is shown once at
--     mint time and never again, so a DB leak can't be replayed as a live token.
--   * RLS is enabled with NO policy → the table is service-role-only. Tokens never
--     touch the public/anon REST surface; every read goes through a server route on
--     the admin client.
--   * Revocation (revoked_at) + expiry (expires_at) are columns the auth path
--     checks on every request.
create table if not exists public.api_tokens (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                          -- human label, e.g. 'card-news-bot'
  token_prefix  text not null,                          -- leading chars of the plaintext, for display only
  token_hash    text not null unique,                   -- sha256 hex of the full plaintext token
  scopes        text[] not null default '{news:read}',  -- capability grants checked per request
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  request_count bigint not null default 0,
  expires_at    timestamptz,                            -- null = never expires
  revoked_at    timestamptz                             -- non-null = dead, rejected by auth
);

-- Exact-match lookup by hash on every authenticated request.
create index if not exists api_tokens_hash_idx on public.api_tokens (token_hash);

-- RLS on, NO policies → service-role-only (see header).
alter table public.api_tokens enable row level security;

-- Usage bump: called fire-and-forget by the auth path on every accepted request,
-- so last_used_at / request_count are advanced atomically (avoids a read-modify-
-- write race). Only the service role reaches it; revoke it from the public roles
-- as defense-in-depth (they can't call it via PostgREST without a policy anyway).
create or replace function public.api_token_touch(p_id uuid)
returns void
language sql
set search_path = public
as $$
  update public.api_tokens
     set last_used_at  = now(),
         request_count = request_count + 1
   where id = p_id;
$$;

revoke all on function public.api_token_touch(uuid) from public, anon, authenticated;
