-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000300 · Tenancy: profiles, shops, membership, subscription
--
-- Tenancy is a column, not a database. Every business table carries shop_id and
-- every policy resolves to "is the caller a member of this shop", so a
-- forgotten .eq('shop_id', …) in the client is a bug rather than a breach.
--
-- The RLS helper functions live at the bottom of this file because they read
-- shop_members and a `language sql` body is name-resolved at creation time.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- profiles — one row per authenticated user
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text,
  -- Phone is the real identity for this user, but true phone-OTP needs a paid
  -- SMS provider. Stored here now so the switch is a config change later.
  phone            text,
  preferred_locale text        not null default 'bn' check (preferred_locale in ('bn', 'en')),
  avatar_url       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.profiles is
  'Per-user profile, created automatically by trg_on_auth_user_created.';

-- ───────────────────────────────────────────────────────────────────────────
-- shops — the tenant
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.shops (
  id                 uuid primary key default gen_random_uuid(),
  name               text        not null check (length(btrim(name)) between 1 and 120),
  name_bn            text,
  -- Denormalised founding owner, for convenience only. Authority always comes
  -- from shop_members, so transferring ownership does not rewrite rows.
  owner_id           uuid        not null references auth.users (id) on delete restrict,
  phone              text,
  address            text,
  district           text,
  currency           char(3)     not null default 'BDT',
  -- Day boundaries are computed in this zone, never UTC: a sale at 11:30 pm
  -- Dhaka belongs to that day's takings.
  timezone           text        not null default 'Asia/Dhaka',
  low_stock_default  numeric(14, 3) not null default 5 check (low_stock_default >= 0),
  invoice_prefix     text        not null default 'MD',
  receipt_footer     text,
  logo_url           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists shops_owner_idx on public.shops (owner_id);

-- ───────────────────────────────────────────────────────────────────────────
-- shop_members — the authorisation table
--
-- user_id is nullable while status = 'invited', because the invite exists
-- before the invitee has an account. accept_invite() binds the two.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.shop_members (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid          not null references public.shops (id) on delete cascade,
  user_id        uuid                   references auth.users (id) on delete cascade,
  role           member_role   not null default 'cashier',
  status         member_status not null default 'active',
  invited_email  text,
  invite_token   text,
  invited_by     uuid                   references auth.users (id) on delete set null,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),

  constraint shop_members_active_needs_user
    check (status <> 'active' or user_id is not null),
  constraint shop_members_invited_needs_email
    check (status <> 'invited' or invited_email is not null)
);

-- One membership per user per shop.
create unique index if not exists shop_members_shop_user_uidx
  on public.shop_members (shop_id, user_id)
  where user_id is not null;

-- No duplicate pending invites to the same address.
create unique index if not exists shop_members_pending_invite_uidx
  on public.shop_members (shop_id, lower(invited_email))
  where status = 'invited';

create index if not exists shop_members_user_idx
  on public.shop_members (user_id) where user_id is not null;

create unique index if not exists shop_members_token_uidx
  on public.shop_members (invite_token) where invite_token is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- subscriptions — one row per shop
--
-- An expired shop degrades to read-only via app.shop_can_write(). Read access
-- to its own history is never revoked: locking a shopkeeper out of his own
-- khata would be indefensible and would end the referral loop permanently.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid        not null unique references public.shops (id) on delete cascade,
  plan               plan_tier   not null default 'trial',
  status             sub_status  not null default 'trialing',
  -- 30 days: anything shorter does not survive one monthly credit cycle, which
  -- is precisely when the value of the khata becomes visible.
  trial_ends_at      timestamptz not null default (now() + interval '30 days'),
  current_period_end timestamptz,
  grace_ends_at      timestamptz,
  monthly_price      numeric(10, 2),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- shop_counters — per-shop invoice numbering
--
-- A Postgres sequence cannot be per-tenant, and max(invoice_no) + 1 races.
-- UPDATE … SET value = value + 1 RETURNING takes a row lock and is safe, so
-- two cashiers ringing up simultaneously cannot collide.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.shop_counters (
  shop_id uuid   not null references public.shops (id) on delete cascade,
  kind    text   not null check (kind in ('sale', 'purchase')),
  value   bigint not null default 0,
  primary key (shop_id, kind)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Shared trigger helpers
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Create the profile on signup so the application never has to handle the
-- "authenticated but no profile" state.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_shops_touch on public.shops;
create trigger trg_shops_touch before update on public.shops
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_shop_members_touch on public.shop_members;
create trigger trg_shop_members_touch before update on public.shop_members
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_subscriptions_touch on public.subscriptions;
create trigger trg_subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS helpers
--
-- Every one of these is SECURITY DEFINER and that is load-bearing, not
-- incidental. The policy on shop_members must ask "is this user a member of
-- this shop", which requires reading shop_members — and under a normal function
-- that read is itself subject to RLS, so Postgres raises
-- `infinite recursion detected in policy for relation "shop_members"`.
-- A SECURITY DEFINER function runs as its owner and bypasses RLS on the tables
-- it reads, which breaks the cycle.
--
-- STABLE lets the planner call them once per statement instead of once per row.
-- search_path is pinned because an unpinned search_path on a definer function
-- is a privilege-escalation vector.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.role_rank(p_role member_role)
returns integer
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case p_role
           when 'owner'   then 3
           when 'manager' then 2
           when 'cashier' then 1
           else 0
         end;
$$;

create or replace function app.is_shop_member(p_shop uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.shop_members m
     where m.shop_id = p_shop
       and m.user_id = auth.uid()
       and m.status  = 'active'
  );
$$;

create or replace function app.has_min_role(p_shop uuid, p_min member_role)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.shop_members m
     where m.shop_id = p_shop
       and m.user_id = auth.uid()
       and m.status  = 'active'
       and app.role_rank(m.role) >= app.role_rank(p_min)
  );
$$;

create or replace function app.my_role(p_shop uuid)
returns member_role
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select m.role
    from public.shop_members m
   where m.shop_id = p_shop
     and m.user_id = auth.uid()
     and m.status  = 'active'
   limit 1;
$$;

create or replace function app.current_shop_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select m.shop_id
    from public.shop_members m
   where m.user_id = auth.uid()
     and m.status  = 'active';
$$;

-- Billing gate. Note the `coalesce(…, true)`: a shop with no subscription row
-- is NOT blocked. Fail open on billing, never on the shopkeeper's data.
create or replace function app.shop_can_write(p_shop uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select s.status = 'active'
        or (s.status = 'trialing' and s.trial_ends_at > now())
        or (s.status = 'past_due' and coalesce(s.grace_ends_at, now() + interval '7 days') > now())
      from public.subscriptions s
     where s.shop_id = p_shop
  ), true);
$$;

-- Per-shop invoice numbering. The ON CONFLICT … DO UPDATE takes a row lock, so
-- concurrent callers serialise and cannot be handed the same number.
create or replace function app.next_counter(p_shop uuid, p_kind text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value bigint;
begin
  insert into public.shop_counters (shop_id, kind, value)
       values (p_shop, p_kind, 1)
  on conflict (shop_id, kind)
  -- Reference the conflicting row by bare table name: ON CONFLICT DO UPDATE
  -- does not accept a schema-qualified prefix here.
  do update set value = shop_counters.value + 1
    returning shop_counters.value into v_value;
  return v_value;
end;
$$;

revoke all on function app.role_rank(member_role)          from public;
revoke all on function app.is_shop_member(uuid)            from public;
revoke all on function app.has_min_role(uuid, member_role) from public;
revoke all on function app.my_role(uuid)                   from public;
revoke all on function app.current_shop_ids()              from public;
revoke all on function app.shop_can_write(uuid)            from public;
revoke all on function app.next_counter(uuid, text)        from public;

grant execute on function app.role_rank(member_role)          to authenticated;
grant execute on function app.is_shop_member(uuid)            to authenticated;
grant execute on function app.has_min_role(uuid, member_role) to authenticated;
grant execute on function app.my_role(uuid)                   to authenticated;
grant execute on function app.current_shop_ids()              to authenticated;
grant execute on function app.shop_can_write(uuid)            to authenticated;
grant execute on function app.next_counter(uuid, text)        to authenticated;
