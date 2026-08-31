-- Admin flag: staff accounts that bypass the paywall entirely.
--
-- An admin never spends credits and always sees gated article bodies. The bypass
-- is enforced server-side (web/app/api/unlock + web/app/api/kbo/article/...), not
-- by RLS — this column is just the flag those routes read via the service role.
-- It is also the account-hierarchy hook: "admin" is now a first-class tier,
-- distinct from "has a large credit balance".
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- One-time backfill: every account that exists today is a founding admin, so flag
-- them all. New signups default to false (a normal, paying account).
--
-- NOTE: this blanket-updates whatever rows exist WHEN THE MIGRATION IS APPLIED.
-- It is correct only while the sole users are the founders. If real (paying)
-- users have signed up before you apply this, replace the statement below with an
-- explicit id list, e.g.:
--   update public.profiles set is_admin = true where id in ('<uuid>', '<uuid>', '<uuid>');
update public.profiles set is_admin = true;
