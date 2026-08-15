-- =====================================================================
-- PitchIQ: profiles (user-editable) + subscriptions (entitlement).
-- Run in Supabase → SQL Editor. Safe and idempotent — re-running is fine.
--
-- Two tables on purpose: users may edit their profile, but NEVER their own
-- plan — that lives in `subscriptions`, writable only by the server.
-- =====================================================================

-- 1) PROFILES — user-owned data
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  fpl_team_id   bigint,          -- powers "My Team" across devices
  favorite_team text,            -- e.g. 'ARS'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2) SUBSCRIPTIONS — the entitlement source of truth
create table if not exists public.subscriptions (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  plan                     text not null default 'free' check (plan in ('free','pro')),
  status                   text not null default 'inactive', -- active|inactive|cancelled|past_due
  provider                 text,          -- 'razorpay'
  provider_subscription_id text,
  current_period_end       timestamptz,   -- paid entitlement expiry (lazy revoke past this)
  last_event_at            timestamptz,   -- provider event time last applied (ordering guard)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
-- Add the ordering column to pre-existing installs (idempotent).
alter table public.subscriptions add column if not exists last_event_at timestamptz;

-- 2c) BILLING_EVENTS — webhook idempotency ledger. One row per provider event id;
-- a duplicate delivery hits the primary key and is skipped. Server-only (no RLS
-- policies), like subscriptions.
create table if not exists public.billing_events (
  event_id         text primary key,   -- provider's x-razorpay-event-id
  event_type       text,
  event_created_at timestamptz,
  received_at      timestamptz not null default now()
);

-- 2b) APP_SETTINGS — admin-tuned, app-wide config (ad cadence & copy, the
-- announcement banner, feature visibility, Manager default club). One JSONB row,
-- key='app'. Written only by the server (service_role); read by everyone.
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) Row-level security
alter table public.profiles       enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.app_settings   enable row level security;
alter table public.billing_events enable row level security;
-- billing_events has NO client policies: only the service_role (server) touches it.

-- profiles: a user reads/updates/inserts ONLY their own row
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

-- subscriptions: a user may READ their own row but never write it.
-- No write policy => all user writes denied by RLS. The service_role
-- (the server) bypasses RLS, so ONLY the server can change a plan.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);

-- 4) Grants (RLS still gates every row)
grant select, insert, update on public.profiles      to authenticated;
grant select                 on public.subscriptions to authenticated;

-- 5) Auto-create both rows for every new signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
    values (new.id, new.email) on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan, status)
    values (new.id, 'free', 'inactive') on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) Keep updated_at current
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();
drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- app_settings has NO client policies on purpose: RLS is enabled and no policy
-- is granted, so only the service_role (the server) can read or write it.

-- 7) Backfill EXISTING users — preserves current Pro (maps legacy elite→pro)
insert into public.profiles (id, email)
  select id, email from auth.users
  on conflict (id) do nothing;

insert into public.subscriptions (user_id, plan, status)
  select id,
         case when raw_app_meta_data->>'plan' in ('pro','elite') then 'pro' else 'free' end,
         case when raw_app_meta_data->>'plan' in ('pro','elite') then 'active' else 'inactive' end
  from auth.users
  on conflict (user_id) do nothing;
