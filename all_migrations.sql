-- MudiDokan Full Schema & Seed

-- === 20260826000100_extensions.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000100 · Extensions and the private `app` schema
-- ═══════════════════════════════════════════════════════════════════════════

-- Supabase keeps extensions out of `public`; create the schema so this file
-- also applies cleanly to a plain Postgres instance.
create schema if not exists extensions;

-- pg_trgm powers search-as-you-type on product names. A shopkeeper types "চাল"
-- or "chal" mid-word, and LIKE '%…%' cannot use a btree index.
create extension if not exists pg_trgm with schema extensions;

-- gen_random_uuid() is core since PG13, but pgcrypto is kept for digest() used
-- when hashing invite tokens.
create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────────────────────────────────────────────────────────
-- Private schema for row-level-security helpers.
-- Kept out of `public` so PostgREST never exposes them as RPC endpoints:
-- these functions are SECURITY DEFINER and must not be callable directly.
-- ───────────────────────────────────────────────────────────────────────────
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, anon, service_role;

comment on schema app is
  'Private helpers for RLS policies and triggers. Not exposed through the API.';


-- === 20260826000200_enums.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000200 · Enumerated types
--
-- Enums rather than lookup tables wherever the set is genuinely closed and
-- shop-independent. Keeps the hot query paths join-free, which matters on a
-- low-end phone over 3G. Adding a value later is one ALTER TYPE.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  create type member_role as enum ('owner', 'manager', 'cashier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_status as enum ('active', 'invited', 'disabled');
exception when duplicate_object then null; end $$;

-- Units a Bangladeshi grocery actually sells in. `hali` is 4 pieces, the
-- standard unit for eggs; `sack` is the bosta rice and flour arrive in.
do $$ begin
  create type unit_type as enum (
    'piece', 'kg', 'gram', 'litre', 'ml', 'dozen', 'hali', 'packet', 'sack', 'bundle'
  );
exception when duplicate_object then null; end $$;

-- Mobile money first, because that is the order of real usage at the counter.
do $$ begin
  create type payment_method as enum (
    'cash', 'bkash', 'nagad', 'rocket', 'card', 'due', 'mixed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type txn_status as enum ('completed', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type party_type as enum ('customer', 'supplier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ledger_entry_type as enum (
    'credit_sale', 'payment_received', 'credit_purchase', 'payment_made',
    'opening_balance', 'adjustment', 'write_off', 'sale_void', 'purchase_void'
  );
exception when duplicate_object then null; end $$;

-- Distinguishing damage from expiry from theft from a counting correction is
-- exactly what turns invisible shrinkage into an auditable number.
do $$ begin
  create type stock_reason as enum (
    'sale', 'purchase', 'sale_void', 'purchase_void',
    'damage', 'expiry', 'theft', 'correction', 'return_out', 'opening'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type expense_category as enum (
    'rent', 'utility', 'salary', 'transport', 'refreshment', 'repair', 'license', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type plan_tier as enum ('trial', 'free', 'basic', 'pro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sub_status as enum ('trialing', 'active', 'past_due', 'canceled');
exception when duplicate_object then null; end $$;


-- === 20260826000300_tenancy.sql ===
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


-- === 20260826000400_catalog.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000400 · Catalogue: categories and products
-- ═══════════════════════════════════════════════════════════════════════════

-- Per-shop rather than a global taxonomy, because a grocery that also sells SIM
-- top-ups and phone cases needs categories no global list would predict.
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  name_bn    text,
  icon       text,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists categories_shop_idx
  on public.categories (shop_id, sort_order, name);

create unique index if not exists categories_shop_name_uidx
  on public.categories (shop_id, lower(name));

-- ───────────────────────────────────────────────────────────────────────────
-- products
--
-- Money is numeric, never float. Binary floating point cannot represent BDT
-- 0.05, and a grocery ledger that fails to balance by one poisha destroys the
-- trust this product depends on.
--
-- stock and thresholds carry three decimals because loose goods sell in 250 g
-- increments and two decimals silently loses grams.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shops (id) on delete cascade,
  category_id          uuid          references public.categories (id) on delete set null,

  name                 text not null check (length(btrim(name)) between 1 and 140),
  name_bn              text,
  sku                  text,
  barcode              text,

  unit                 unit_type      not null default 'piece',
  -- Flips the POS to the weight pad instead of a quantity stepper.
  is_weighted          boolean        not null default false,

  buy_price            numeric(14, 2) not null default 0 check (buy_price  >= 0),
  sell_price           numeric(14, 2) not null default 0 check (sell_price >= 0),

  -- CACHE. Only ever written by trg_stock_ledger_after. Rebuildable with
  -- recalc_product_stock(), so a bug in the trigger is recoverable rather than
  -- corrupting. Allowed to go negative: if goods left the shop while the phone
  -- was offline, refusing to record that would be the wrong trade.
  stock                numeric(14, 3) not null default 0,
  low_stock_threshold  numeric(14, 3) not null default 5 check (low_stock_threshold >= 0),

  expiry_date          date,
  image_url            text,
  note                 text,
  is_active            boolean     not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column public.products.stock is
  'Trigger-maintained cache over stock_ledger. Never write from application code.';

-- Catalogue listing and filtering.
create index if not exists products_shop_active_idx
  on public.products (shop_id, is_active, name);

create index if not exists products_category_idx
  on public.products (category_id) where category_id is not null;

-- Search-as-you-type in both scripts. Trigram, because the shopkeeper types
-- from the middle of the word as often as from the start.
create index if not exists products_name_trgm_idx
  on public.products using gin (name extensions.gin_trgm_ops);

create index if not exists products_name_bn_trgm_idx
  on public.products using gin (name_bn extensions.gin_trgm_ops);

-- Many products have no barcode; those that do must be unique within the shop.
create unique index if not exists products_shop_barcode_uidx
  on public.products (shop_id, barcode) where barcode is not null;

create index if not exists products_expiry_idx
  on public.products (shop_id, expiry_date) where expiry_date is not null;

-- Partial index for the low-stock screen. Stays small even when the catalogue
-- does not, because most products are fine most of the time.
create index if not exists products_low_stock_idx
  on public.products (shop_id, stock)
  where is_active and stock <= low_stock_threshold;

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.touch_updated_at();


-- === 20260826000500_parties.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000500 · Parties: customers and suppliers
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- customers — the people with a page in the khata
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops (id) on delete cascade,

  name         text not null check (length(btrim(name)) between 1 and 120),
  phone        text,
  address      text,
  photo_url    text,

  -- CACHE over party_ledger, maintained by trg_party_ledger_after.
  -- Positive = the customer owes the shop. Rebuildable with
  -- recalc_customer_balance().
  due_balance  numeric(14, 2) not null default 0,

  -- 0 means no limit. The POS warns, it does not block: refusing a twenty-year
  -- neighbour over a software rule is not a decision software should make.
  credit_limit numeric(14, 2) not null default 0 check (credit_limit >= 0),

  note         text,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.customers.due_balance is
  'Trigger-maintained cache over party_ledger. Never write from application code.';

create index if not exists customers_shop_name_idx
  on public.customers (shop_id, is_active, name);

create index if not exists customers_name_trgm_idx
  on public.customers using gin (name extensions.gin_trgm_ops);

create index if not exists customers_phone_idx
  on public.customers (shop_id, phone) where phone is not null;

-- The dues list. Partial, so it stays small even when the customer table grows.
create index if not exists customers_dues_idx
  on public.customers (shop_id, due_balance desc) where due_balance > 0;

drop trigger if exists trg_customers_touch on public.customers;
create trigger trg_customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- suppliers — the distributors and wholesalers (মহাজন)
-- Mirror image of customers: positive due_balance = the shop owes them.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,

  name        text not null check (length(btrim(name)) between 1 and 120),
  company     text,
  phone       text,
  address     text,

  -- CACHE over party_ledger. Positive = the shop owes the supplier.
  due_balance numeric(14, 2) not null default 0,

  note        text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.suppliers.due_balance is
  'Trigger-maintained cache over party_ledger. Never write from application code.';

create index if not exists suppliers_shop_name_idx
  on public.suppliers (shop_id, is_active, name);

create index if not exists suppliers_dues_idx
  on public.suppliers (shop_id, due_balance desc) where due_balance > 0;

drop trigger if exists trg_suppliers_touch on public.suppliers;
create trigger trg_suppliers_touch before update on public.suppliers
  for each row execute function public.touch_updated_at();


-- === 20260826000600_transactions.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000600 · Transactions: sales, purchases, payments, expenses
--
-- Every table here carries client_uuid with a unique index per shop. That one
-- column is what makes offline replay safe: the dangerous case is a request
-- that commits in Postgres but whose response is lost to a dropped tower, and
-- the device cannot tell that apart from a request that never arrived. It must
-- retry — and a naive retry would double-decrement stock and double a
-- customer's baki. Because the UUID is generated on the device before the first
-- attempt, the retry is free.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- sales
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.sales (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid   not null references public.shops (id) on delete cascade,
  invoice_no     bigint not null,

  -- Nullable: most sales are walk-ins with no khata page.
  customer_id    uuid            references public.customers (id) on delete set null,

  subtotal       numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount       numeric(14, 2) not null default 0 check (discount >= 0),
  total          numeric(14, 2) not null default 0 check (total    >= 0),
  paid           numeric(14, 2) not null default 0,

  -- Stored generated: due can never disagree with its inputs. Negative means
  -- the customer paid ahead, which legitimately reduces an older baki.
  due            numeric(14, 2) generated always as (total - paid) stored,

  payment_method payment_method not null default 'cash',
  status         txn_status     not null default 'completed',
  note           text,
  void_reason    text,

  sold_at        timestamptz not null default now(),
  created_by     uuid                 references auth.users (id) on delete set null,
  client_uuid    uuid        not null default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The idempotency backstop: two concurrent retries cannot both insert.
create unique index if not exists sales_shop_client_uuid_uidx
  on public.sales (shop_id, client_uuid);

create unique index if not exists sales_shop_invoice_uidx
  on public.sales (shop_id, invoice_no);

create index if not exists sales_shop_date_idx
  on public.sales (shop_id, sold_at desc);

create index if not exists sales_customer_idx
  on public.sales (customer_id, sold_at desc) where customer_id is not null;

create index if not exists sales_created_by_idx
  on public.sales (shop_id, created_by, sold_at desc);

drop trigger if exists trg_sales_touch on public.sales;
create trigger trg_sales_touch before update on public.sales
  for each row execute function public.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- sale_items
--
-- Two snapshot columns carry real weight here:
--   product_name_snapshot — a renamed or deleted product must not rewrite the
--     history on an old receipt.
--   buy_price_snapshot    — cost at the moment of sale. This is what makes
--     gross profit computable rather than estimated, and it is the single most
--     valuable reporting column in the schema. Without it, recalculating last
--     month's margin after a cost change silently gives the wrong answer.
--
-- shop_id is denormalised so RLS evaluates without joining to the parent, on
-- the table that grows fastest.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.sale_items (
  id                    uuid primary key default gen_random_uuid(),
  sale_id               uuid not null references public.sales (id) on delete cascade,
  shop_id               uuid not null references public.shops (id) on delete cascade,
  product_id            uuid          references public.products (id) on delete set null,

  product_name_snapshot text           not null,
  qty                   numeric(14, 3) not null check (qty > 0),
  unit                  unit_type      not null default 'piece',
  unit_price            numeric(14, 2) not null check (unit_price >= 0),
  buy_price_snapshot    numeric(14, 2) not null default 0,
  line_discount         numeric(14, 2) not null default 0 check (line_discount >= 0),

  line_total numeric(14, 2)
    generated always as (round(qty * unit_price, 2) - line_discount) stored,

  created_at timestamptz not null default now()
);

create index if not exists sale_items_sale_idx    on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (shop_id, product_id);

-- ───────────────────────────────────────────────────────────────────────────
-- purchases — goods coming in from a distributor (মাল তোলা)
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.purchases (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid   not null references public.shops (id) on delete cascade,
  invoice_no   bigint not null,
  supplier_id  uuid            references public.suppliers (id) on delete set null,

  -- The distributor's own memo number, so the two books can be reconciled.
  supplier_ref text,

  subtotal     numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount     numeric(14, 2) not null default 0 check (discount >= 0),
  total        numeric(14, 2) not null default 0 check (total    >= 0),
  paid         numeric(14, 2) not null default 0,
  due          numeric(14, 2) generated always as (total - paid) stored,

  status       txn_status  not null default 'completed',
  note         text,
  void_reason  text,

  purchased_at timestamptz not null default now(),
  created_by   uuid                 references auth.users (id) on delete set null,
  client_uuid  uuid        not null default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists purchases_shop_client_uuid_uidx
  on public.purchases (shop_id, client_uuid);

create unique index if not exists purchases_shop_invoice_uidx
  on public.purchases (shop_id, invoice_no);

create index if not exists purchases_shop_date_idx
  on public.purchases (shop_id, purchased_at desc);

create index if not exists purchases_supplier_idx
  on public.purchases (supplier_id, purchased_at desc) where supplier_id is not null;

drop trigger if exists trg_purchases_touch on public.purchases;
create trigger trg_purchases_touch before update on public.purchases
  for each row execute function public.touch_updated_at();

create table if not exists public.purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  shop_id     uuid not null references public.shops (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete restrict,

  qty         numeric(14, 3) not null check (qty > 0),
  unit        unit_type      not null default 'piece',
  unit_cost   numeric(14, 2) not null check (unit_cost >= 0),
  line_total  numeric(14, 2) generated always as (round(qty * unit_cost, 2)) stored,

  created_at  timestamptz not null default now()
);

create index if not exists purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index if not exists purchase_items_product_idx  on public.purchase_items (shop_id, product_id);

-- ───────────────────────────────────────────────────────────────────────────
-- payments — money moving in either direction against either party type
--
-- Sign convention, stated once and applied everywhere:
--   money TOWARD the shop  → reduces a customer's due, increases a supplier's
--   money AWAY from the shop → increases a customer's due, reduces a supplier's
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,

  party       party_type        not null,
  customer_id uuid                       references public.customers (id) on delete cascade,
  supplier_id uuid                       references public.suppliers (id) on delete cascade,

  direction   payment_direction not null,
  amount      numeric(14, 2)    not null check (amount > 0),
  method      payment_method    not null default 'cash',

  -- Optional link to what is being settled.
  sale_id     uuid references public.sales (id)     on delete set null,
  purchase_id uuid references public.purchases (id) on delete set null,

  note        text,
  paid_at     timestamptz not null default now(),
  created_by  uuid                 references auth.users (id) on delete set null,
  client_uuid uuid        not null default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- The polymorphic reference cannot be half-populated.
  constraint payments_party_matches_fk check (
    (party = 'customer' and customer_id is not null and supplier_id is null) or
    (party = 'supplier' and supplier_id is not null and customer_id is null)
  )
);

create unique index if not exists payments_shop_client_uuid_uidx
  on public.payments (shop_id, client_uuid);

create index if not exists payments_customer_idx
  on public.payments (shop_id, customer_id, paid_at desc) where customer_id is not null;

create index if not exists payments_supplier_idx
  on public.payments (shop_id, supplier_id, paid_at desc) where supplier_id is not null;

create index if not exists payments_shop_date_idx on public.payments (shop_id, paid_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- expenses
--
-- Deliberately the simplest table in the schema. Friction here means it does
-- not get used, and unrecorded expenses make net profit fiction.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid             not null references public.shops (id) on delete cascade,
  category    expense_category not null default 'other',
  amount      numeric(14, 2)   not null check (amount > 0),
  note        text,
  spent_at    timestamptz      not null default now(),
  created_by  uuid                      references auth.users (id) on delete set null,
  client_uuid uuid             not null default gen_random_uuid(),
  created_at  timestamptz      not null default now()
);

create unique index if not exists expenses_shop_client_uuid_uidx
  on public.expenses (shop_id, client_uuid);

create index if not exists expenses_shop_date_idx
  on public.expenses (shop_id, spent_at desc);


-- === 20260826000700_ledgers.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000700 · The ledgers
--
-- These two tables are the heart of the schema. Nothing writes to them from the
-- client; they are populated by triggers on the transaction tables, and they in
-- turn drive the cached balances on products, customers, and suppliers.
--
-- They are append-only. RLS grants select and insert, never update or delete,
-- to any role. That constraint is what makes them evidence rather than notes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- stock_ledger — every movement of physical goods
--
-- This is what answers "where did 8 kg of sugar go?" with a timestamp and a
-- staff name attached. Current stock is a computed consequence of this table,
-- never a number someone typed.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_ledger (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid           not null references public.shops (id)    on delete cascade,
  product_id    uuid           not null references public.products (id) on delete cascade,

  -- Negative leaves the shop, positive arrives.
  delta         numeric(14, 3) not null check (delta <> 0),
  reason        stock_reason   not null,

  -- What caused it. ref_table is a plain text tag rather than a foreign key
  -- because the source is polymorphic.
  ref_table     text,
  ref_id        uuid,

  -- Stamped by the trigger so the ledger reads like a bank statement without a
  -- window function running on a phone.
  balance_after numeric(14, 3) not null,

  note          text,
  created_by    uuid                 references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.stock_ledger is
  'Append-only. Owns products.stock via trg_stock_ledger_after. Never updated or deleted.';

create index if not exists stock_ledger_product_idx
  on public.stock_ledger (shop_id, product_id, created_at desc);

create index if not exists stock_ledger_shop_date_idx
  on public.stock_ledger (shop_id, created_at desc);

create index if not exists stock_ledger_reason_idx
  on public.stock_ledger (shop_id, reason, created_at desc);

-- Replay guard: a trigger that somehow fires twice cannot double-post. The
-- reason is part of the key so a reversal (reason = 'sale_void') can coexist
-- with the original row (reason = 'sale') for the same source record.
--
-- 'correction' is excluded because a shopkeeper may legitimately correct the
-- same product more than once, and the guard exists to make automatic postings
-- idempotent, not to cap manual entries.
create unique index if not exists stock_ledger_ref_uidx
  on public.stock_ledger (ref_table, ref_id, reason)
  where ref_id is not null and reason <> 'correction';

-- Idempotency for manual adjustments arriving from the offline outbox.
-- adjust_stock() writes ref_table = 'manual', ref_id = the device-generated
-- client_uuid, so a blind retry lands on this index instead of double-counting.
create unique index if not exists stock_ledger_manual_uidx
  on public.stock_ledger (shop_id, ref_id)
  where ref_table = 'manual';

-- ───────────────────────────────────────────────────────────────────────────
-- party_ledger — the digital khata itself
--
-- `amount` is the signed delta applied to the party's due_balance:
--   customer: positive means they owe the shop more
--   supplier: positive means the shop owes them more
--
-- Rendering a customer statement is one indexed, ordered read: no aggregation
-- on the client, which matters both for speed and for making the screen work
-- from cache when the network is gone.
--
-- Nothing is ever edited in place. A correction posts a new entry, and a
-- write-off is an explicit visible row rather than a quiet edit. That is what
-- makes the number trustworthy enough to turn the screen toward a customer.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.party_ledger (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid              not null references public.shops (id) on delete cascade,

  party         party_type        not null,
  customer_id   uuid                       references public.customers (id) on delete cascade,
  supplier_id   uuid                       references public.suppliers (id) on delete cascade,

  entry_type    ledger_entry_type not null,
  amount        numeric(14, 2)    not null check (amount <> 0),

  ref_table     text,
  ref_id        uuid,

  balance_after numeric(14, 2)    not null,

  note          text,
  occurred_at   timestamptz not null default now(),
  created_by    uuid                 references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint party_ledger_party_matches_fk check (
    (party = 'customer' and customer_id is not null and supplier_id is null) or
    (party = 'supplier' and supplier_id is not null and customer_id is null)
  )
);

comment on table public.party_ledger is
  'Append-only. Owns customers.due_balance and suppliers.due_balance. Never updated or deleted.';

-- These two indexes carry the khata statement screen.
create index if not exists party_ledger_customer_idx
  on public.party_ledger (shop_id, customer_id, occurred_at desc)
  where customer_id is not null;

create index if not exists party_ledger_supplier_idx
  on public.party_ledger (shop_id, supplier_id, occurred_at desc)
  where supplier_id is not null;

create index if not exists party_ledger_shop_date_idx
  on public.party_ledger (shop_id, occurred_at desc);

create index if not exists party_ledger_type_idx
  on public.party_ledger (shop_id, entry_type, occurred_at desc);

-- Same replay guard as stock_ledger. 'adjustment' and 'write_off' are excluded
-- because those are deliberate human entries and may recur against the same
-- source record.
create unique index if not exists party_ledger_ref_uidx
  on public.party_ledger (ref_table, ref_id, entry_type)
  where ref_id is not null and entry_type not in ('adjustment', 'write_off');

-- Same idempotency guard for hand-entered ledger rows (opening balances,
-- write-offs) replayed from the offline outbox.
create unique index if not exists party_ledger_manual_uidx
  on public.party_ledger (shop_id, ref_id)
  where ref_table = 'manual';

-- ───────────────────────────────────────────────────────────────────────────
-- activity_log
--
-- Insert-only, readable by managers and owners. Staff turnover in these shops
-- is high; when the count disagrees with the screen, someone will ask who did
-- what, and there needs to be an answer.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops (id) on delete cascade,
  user_id    uuid          references auth.users (id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  uuid,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_shop_date_idx
  on public.activity_log (shop_id, created_at desc);

create index if not exists activity_log_entity_idx
  on public.activity_log (shop_id, entity, entity_id);


-- === 20260826000800_triggers.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000800 · Triggers — who owns which number
--
-- THE CONTRACT: nothing outside this file may write products.stock,
-- customers.due_balance, or suppliers.due_balance. Application code inserts
-- transaction rows; the database derives the consequences. This holds whether
-- the write arrives through PostgREST, through an RPC, through the SQL editor,
-- or through a replayed offline outbox — which is the whole point.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- stock_ledger → products.stock
--
-- The BEFORE half takes `FOR UPDATE` on the product row. That lock is what
-- serialises concurrent movements of the same product, so two cashiers selling
-- the last two bags of sugar cannot both read the same starting balance.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_stock_ledger_before()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_stock numeric(14, 3);
  v_shop  uuid;
begin
  select p.stock, p.shop_id
    into v_stock, v_shop
    from public.products p
   where p.id = new.product_id
     for update;

  if not found then
    raise exception 'product % does not exist', new.product_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Convenience for trigger callers: derive the tenant from the product.
  if new.shop_id is null then
    new.shop_id := v_shop;
  elsif new.shop_id <> v_shop then
    raise exception 'product % belongs to a different shop', new.product_id
      using errcode = 'check_violation';
  end if;

  new.balance_after := v_stock + new.delta;
  return new;
end;
$$;

create or replace function public.trg_stock_ledger_after()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Opens the gate that trg_guard_products_stock watches (see the bottom of this
  -- file). Transaction-local, so it cannot leak into another connection.
  perform set_config('app.derived_write', 'on', true);

  -- balance_after was computed under the row lock taken in the BEFORE trigger,
  -- so assigning it here cannot lose a concurrent update.
  update public.products
     set stock = new.balance_after
   where id = new.product_id;
  return null;
end;
$$;

drop trigger if exists trg_stock_ledger_before_ins on public.stock_ledger;
create trigger trg_stock_ledger_before_ins
  before insert on public.stock_ledger
  for each row execute function public.trg_stock_ledger_before();

drop trigger if exists trg_stock_ledger_after_ins on public.stock_ledger;
create trigger trg_stock_ledger_after_ins
  after insert on public.stock_ledger
  for each row execute function public.trg_stock_ledger_after();

-- ───────────────────────────────────────────────────────────────────────────
-- party_ledger → customers.due_balance / suppliers.due_balance
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_party_ledger_before()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_balance numeric(14, 2);
  v_shop    uuid;
begin
  if new.party = 'customer' then
    select c.due_balance, c.shop_id
      into v_balance, v_shop
      from public.customers c
     where c.id = new.customer_id
       for update;
    if not found then
      raise exception 'customer % does not exist', new.customer_id
        using errcode = 'foreign_key_violation';
    end if;
  else
    select s.due_balance, s.shop_id
      into v_balance, v_shop
      from public.suppliers s
     where s.id = new.supplier_id
       for update;
    if not found then
      raise exception 'supplier % does not exist', new.supplier_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if new.shop_id is null then
    new.shop_id := v_shop;
  elsif new.shop_id <> v_shop then
    raise exception 'party belongs to a different shop'
      using errcode = 'check_violation';
  end if;

  new.balance_after := v_balance + new.amount;
  return new;
end;
$$;

create or replace function public.trg_party_ledger_after()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.derived_write', 'on', true);

  if new.party = 'customer' then
    update public.customers set due_balance = new.balance_after where id = new.customer_id;
  else
    update public.suppliers set due_balance = new.balance_after where id = new.supplier_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_party_ledger_before_ins on public.party_ledger;
create trigger trg_party_ledger_before_ins
  before insert on public.party_ledger
  for each row execute function public.trg_party_ledger_before();

drop trigger if exists trg_party_ledger_after_ins on public.party_ledger;
create trigger trg_party_ledger_after_ins
  after insert on public.party_ledger
  for each row execute function public.trg_party_ledger_after();

-- ───────────────────────────────────────────────────────────────────────────
-- sale_items — snapshots, then stock movement
--
-- The snapshot trigger runs BEFORE INSERT, so NOT NULL on
-- product_name_snapshot is satisfied even when the caller omits it: BEFORE
-- triggers run ahead of constraint checks.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_sale_item_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_bn   text;
  v_buy  numeric(14, 2);
  v_unit unit_type;
begin
  if new.product_id is not null then
    select p.name, p.name_bn, p.buy_price, p.unit
      into v_name, v_bn, v_buy, v_unit
      from public.products p
     where p.id = new.product_id;
  end if;

  -- Prefer the Bengali name on the receipt: that is what the shopkeeper reads.
  if new.product_name_snapshot is null or btrim(new.product_name_snapshot) = '' then
    new.product_name_snapshot := coalesce(nullif(btrim(coalesce(v_bn, '')), ''), v_name, '—');
  end if;

  -- Cost at the moment of sale. Captured here so a later price change cannot
  -- retroactively rewrite last month's margin.
  if new.buy_price_snapshot is null or new.buy_price_snapshot = 0 then
    new.buy_price_snapshot := coalesce(v_buy, 0);
  end if;

  if new.unit is null then
    new.unit := coalesce(v_unit, 'piece');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sale_items_snapshot on public.sale_items;
create trigger trg_sale_items_snapshot
  before insert on public.sale_items
  for each row execute function public.trg_sale_item_snapshot();

create or replace function public.trg_sale_items_stock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status txn_status;
begin
  if tg_op = 'INSERT' then
    if new.product_id is null then
      return new;  -- ad-hoc line with no catalogue item: nothing to move
    end if;

    -- Guard against items appended to an already-voided sale.
    select s.status into v_status from public.sales s where s.id = new.sale_id;
    if v_status is distinct from 'completed' then
      return new;
    end if;

    insert into public.stock_ledger
      (shop_id, product_id, delta, reason, ref_table, ref_id, created_by)
    values
      (new.shop_id, new.product_id, -new.qty, 'sale', 'sale_items', new.id, auth.uid());

    return new;
  end if;

  -- DELETE: put the goods back with a compensating row. Nothing is erased.
  if old.product_id is not null then
    insert into public.stock_ledger
      (shop_id, product_id, delta, reason, ref_table, ref_id, note, created_by)
    values
      (old.shop_id, old.product_id, old.qty, 'correction', 'sale_items', old.id,
       'বিক্রয়ের লাইন মুছে ফেলা হয়েছে', auth.uid());
  end if;
  return old;
end;
$$;

drop trigger if exists trg_sale_items_stock_ins on public.sale_items;
create trigger trg_sale_items_stock_ins
  after insert on public.sale_items
  for each row execute function public.trg_sale_items_stock();

drop trigger if exists trg_sale_items_stock_del on public.sale_items;
create trigger trg_sale_items_stock_del
  after delete on public.sale_items
  for each row execute function public.trg_sale_items_stock();

-- ───────────────────────────────────────────────────────────────────────────
-- sales → party_ledger
--
-- These fire AFTER INSERT, not BEFORE, and that matters: `due` is a STORED
-- generated column, so it is still NULL in a BEFORE trigger and only populated
-- once the row is written.
--
-- Posts on `due <> 0`, not `due > 0`, so a customer who pays more than the bill
-- automatically has the surplus applied against their older baki. That is what
-- actually happens at the counter on payday.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_sales_party_ledger_ins()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is not null and new.due <> 0 and new.status = 'completed' then
    insert into public.party_ledger
      (shop_id, party, customer_id, entry_type, amount, ref_table, ref_id,
       note, occurred_at, created_by)
    values
      (new.shop_id, 'customer', new.customer_id, 'credit_sale', new.due,
       'sales', new.id, 'বিক্রয় #' || new.invoice_no, new.sold_at, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sales_party_ledger_after_ins on public.sales;
create trigger trg_sales_party_ledger_after_ins
  after insert on public.sales
  for each row execute function public.trg_sales_party_ledger_ins();

create or replace function public.trg_sales_after_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- ── Void: reverse through compensating rows, never by deleting ──────────
  if old.status = 'completed' and new.status = 'void' then
    insert into public.stock_ledger
      (shop_id, product_id, delta, reason, ref_table, ref_id, note, created_by)
    select si.shop_id, si.product_id, si.qty, 'sale_void', 'sale_items', si.id,
           'বিক্রয় বাতিল #' || new.invoice_no, auth.uid()
      from public.sale_items si
     where si.sale_id = new.id
       and si.product_id is not null;

    if new.customer_id is not null and old.due <> 0 then
      insert into public.party_ledger
        (shop_id, party, customer_id, entry_type, amount, ref_table, ref_id,
         note, created_by)
      values
        (new.shop_id, 'customer', new.customer_id, 'sale_void', -old.due,
         'sales', new.id,
         coalesce(nullif(btrim(coalesce(new.void_reason, '')), ''), 'বিক্রয় বাতিল'),
         auth.uid());
    end if;

    return null;
  end if;

  -- ── Correction to a live sale: post the delta as its own visible entry ──
  if new.status = 'completed'
     and new.customer_id is not null
     and new.customer_id = old.customer_id
     and new.due <> old.due
  then
    insert into public.party_ledger
      (shop_id, party, customer_id, entry_type, amount, ref_table, ref_id,
       note, created_by)
    values
      (new.shop_id, 'customer', new.customer_id, 'adjustment', new.due - old.due,
       'sales', new.id, 'বিক্রয় #' || new.invoice_no || ' সংশোধন', auth.uid());
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sales_after_upd on public.sales;
create trigger trg_sales_after_upd
  after update on public.sales
  for each row execute function public.trg_sales_after_update();

-- ───────────────────────────────────────────────────────────────────────────
-- purchase_items → stock in, and the latest cost up to the product
--
-- Latest cost rather than weighted average, deliberately: "what did I pay last
-- time" is the question a shopkeeper asks before every negotiation with the
-- distributor's rep, and it is the number he can verify against his own memory.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_purchase_items_stock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status txn_status;
begin
  if tg_op = 'INSERT' then
    select p.status into v_status from public.purchases p where p.id = new.purchase_id;
    if v_status is distinct from 'completed' then
      return new;
    end if;

    insert into public.stock_ledger
      (shop_id, product_id, delta, reason, ref_table, ref_id, created_by)
    values
      (new.shop_id, new.product_id, new.qty, 'purchase', 'purchase_items', new.id, auth.uid());

    -- Only when the purchase unit matches the product's selling unit, otherwise
    -- a per-sack cost would silently become the per-kg cost.
    update public.products
       set buy_price = new.unit_cost
     where id = new.product_id
       and unit = new.unit
       and new.unit_cost > 0;

    return new;
  end if;

  insert into public.stock_ledger
    (shop_id, product_id, delta, reason, ref_table, ref_id, note, created_by)
  values
    (old.shop_id, old.product_id, -old.qty, 'correction', 'purchase_items', old.id,
     'মাল তোলার লাইন মুছে ফেলা হয়েছে', auth.uid());
  return old;
end;
$$;

drop trigger if exists trg_purchase_items_stock_ins on public.purchase_items;
create trigger trg_purchase_items_stock_ins
  after insert on public.purchase_items
  for each row execute function public.trg_purchase_items_stock();

drop trigger if exists trg_purchase_items_stock_del on public.purchase_items;
create trigger trg_purchase_items_stock_del
  after delete on public.purchase_items
  for each row execute function public.trg_purchase_items_stock();

-- ───────────────────────────────────────────────────────────────────────────
-- purchases → party_ledger
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_purchases_party_ledger_ins()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.supplier_id is not null and new.due <> 0 and new.status = 'completed' then
    insert into public.party_ledger
      (shop_id, party, supplier_id, entry_type, amount, ref_table, ref_id,
       note, occurred_at, created_by)
    values
      (new.shop_id, 'supplier', new.supplier_id, 'credit_purchase', new.due,
       'purchases', new.id, 'মাল তোলা #' || new.invoice_no, new.purchased_at, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists trg_purchases_party_ledger_after_ins on public.purchases;
create trigger trg_purchases_party_ledger_after_ins
  after insert on public.purchases
  for each row execute function public.trg_purchases_party_ledger_ins();

create or replace function public.trg_purchases_after_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'completed' and new.status = 'void' then
    insert into public.stock_ledger
      (shop_id, product_id, delta, reason, ref_table, ref_id, note, created_by)
    select pi.shop_id, pi.product_id, -pi.qty, 'purchase_void', 'purchase_items', pi.id,
           'মাল তোলা বাতিল #' || new.invoice_no, auth.uid()
      from public.purchase_items pi
     where pi.purchase_id = new.id;

    if new.supplier_id is not null and old.due <> 0 then
      insert into public.party_ledger
        (shop_id, party, supplier_id, entry_type, amount, ref_table, ref_id,
         note, created_by)
      values
        (new.shop_id, 'supplier', new.supplier_id, 'purchase_void', -old.due,
         'purchases', new.id,
         coalesce(nullif(btrim(coalesce(new.void_reason, '')), ''), 'মাল তোলা বাতিল'),
         auth.uid());
    end if;
    return null;
  end if;

  if new.status = 'completed'
     and new.supplier_id is not null
     and new.supplier_id = old.supplier_id
     and new.due <> old.due
  then
    insert into public.party_ledger
      (shop_id, party, supplier_id, entry_type, amount, ref_table, ref_id,
       note, created_by)
    values
      (new.shop_id, 'supplier', new.supplier_id, 'adjustment', new.due - old.due,
       'purchases', new.id, 'মাল তোলা #' || new.invoice_no || ' সংশোধন', auth.uid());
  end if;

  return null;
end;
$$;

drop trigger if exists trg_purchases_after_upd on public.purchases;
create trigger trg_purchases_after_upd
  after update on public.purchases
  for each row execute function public.trg_purchases_after_update();

-- ───────────────────────────────────────────────────────────────────────────
-- payments → party_ledger
--
-- One rule, applied to both party types:
--   money toward the shop  → customer owes less, supplier is owed more
--   money away from the shop → customer owes more, supplier is owed less
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_payments_party_ledger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_delta numeric(14, 2);
  v_type  ledger_entry_type;
begin
  if new.party = 'customer' then
    v_delta := case when new.direction = 'in' then -new.amount else new.amount end;
    v_type  := case when new.direction = 'in' then 'payment_received'::ledger_entry_type
                                              else 'adjustment'::ledger_entry_type end;

    insert into public.party_ledger
      (shop_id, party, customer_id, entry_type, amount, ref_table, ref_id,
       note, occurred_at, created_by)
    values
      (new.shop_id, 'customer', new.customer_id, v_type, v_delta,
       'payments', new.id, new.note, new.paid_at, auth.uid());
  else
    v_delta := case when new.direction = 'out' then -new.amount else new.amount end;
    v_type  := case when new.direction = 'out' then 'payment_made'::ledger_entry_type
                                               else 'adjustment'::ledger_entry_type end;

    insert into public.party_ledger
      (shop_id, party, supplier_id, entry_type, amount, ref_table, ref_id,
       note, occurred_at, created_by)
    values
      (new.shop_id, 'supplier', new.supplier_id, v_type, v_delta,
       'payments', new.id, new.note, new.paid_at, auth.uid());
  end if;

  return null;
end;
$$;

drop trigger if exists trg_payments_party_ledger_after_ins on public.payments;
create trigger trg_payments_party_ledger_after_ins
  after insert on public.payments
  for each row execute function public.trg_payments_party_ledger();

-- ═══════════════════════════════════════════════════════════════════════════
-- Enforcing the contract
--
-- Everything above is only a convention until something stops a well-meaning
-- developer — or a curious manager with the API key and a REST client — from
-- doing PATCH /products?id=eq.… {"stock": 500}. RLS cannot help: it decides
-- which ROWS you may touch, never which COLUMNS.
--
-- So the three derived columns are guarded directly. A write is permitted only
-- while `app.derived_write` is on, and the only places that turn it on are the
-- two ledger AFTER triggers and the recalc_* functions. A hand-written UPDATE
-- gets a clear error naming what to do instead, which is the difference between
-- a contract and a comment.
--
-- set_config(..., true) is transaction-local: it cannot leak to another
-- connection, and inside a sale's transaction further derived writes are exactly
-- what we want to allow.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.trg_guard_derived_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_open boolean := coalesce(current_setting('app.derived_write', true), 'off') = 'on';
begin
  if v_open then
    return new;
  end if;

  if tg_table_name = 'products' and new.stock is distinct from old.stock then
    raise exception
      'products.stock is derived from stock_ledger — record a stock movement (adjust_stock) instead of editing it'
      using errcode = '42501';
  end if;

  if tg_table_name in ('customers', 'suppliers')
     and new.due_balance is distinct from old.due_balance then
    raise exception
      '%.due_balance is derived from party_ledger — record a payment or an adjustment instead of editing it',
      tg_table_name
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_products_guard_derived on public.products;
create trigger trg_products_guard_derived
  before update on public.products
  for each row execute function public.trg_guard_derived_columns();

drop trigger if exists trg_customers_guard_derived on public.customers;
create trigger trg_customers_guard_derived
  before update on public.customers
  for each row execute function public.trg_guard_derived_columns();

drop trigger if exists trg_suppliers_guard_derived on public.suppliers;
create trigger trg_suppliers_guard_derived
  before update on public.suppliers
  for each row execute function public.trg_guard_derived_columns();


-- === 20260826000900_views.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000900 · Reporting views
--
-- EVERY view here is declared WITH (security_invoker = on).
--
-- This is not a stylistic preference. A view created the default way executes
-- as its OWNER, which means RLS on the base tables is evaluated against the
-- owner — and since `postgres` owns these tables, the view would happily return
-- every shop's data to every authenticated user. It is the single most
-- dangerous mistake available in a Supabase schema. security_invoker = on makes
-- the caller's policies apply instead.
--
-- Requires PostgreSQL 15 or newer.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- v_products_status — the catalogue with the numbers a shopkeeper reads
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_products_status
with (security_invoker = on) as
select
  p.id,
  p.shop_id,
  p.category_id,
  c.name    as category_name,
  c.name_bn as category_name_bn,
  p.name,
  p.name_bn,
  p.sku,
  p.barcode,
  p.unit,
  p.is_weighted,
  p.buy_price,
  p.sell_price,
  p.stock,
  p.low_stock_threshold,
  p.expiry_date,
  p.image_url,
  p.is_active,
  p.created_at,
  p.updated_at,

  (p.sell_price - p.buy_price) as margin,
  case when p.sell_price > 0
       then round(((p.sell_price - p.buy_price) / p.sell_price) * 100, 1)
       else null end as margin_pct,

  round(p.stock * p.buy_price, 2)  as stock_value_at_cost,
  round(p.stock * p.sell_price, 2) as stock_value_at_retail,

  case
    when p.stock <= 0                      then 'out'
    when p.stock <= p.low_stock_threshold  then 'low'
    else 'ok'
  end as stock_state,

  case when p.expiry_date is not null
       then (p.expiry_date - current_date)
       else null end as days_to_expiry
from public.products p
left join public.categories c on c.id = p.category_id;

-- ───────────────────────────────────────────────────────────────────────────
-- v_low_stock — the shopping list, ready before the distributor's van arrives
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_low_stock
with (security_invoker = on) as
select *,
       greatest(low_stock_threshold * 2 - stock, low_stock_threshold) as suggested_order_qty
from public.v_products_status
where is_active
  and stock_state in ('low', 'out');

-- ───────────────────────────────────────────────────────────────────────────
-- v_expiring_soon — turns would-be write-offs into discounted sales
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_expiring_soon
with (security_invoker = on) as
select *,
       case
         when days_to_expiry < 0  then 'expired'
         when days_to_expiry <= 7 then 'urgent'
         when days_to_expiry <= 14 then 'soon'
         else 'watch'
       end as expiry_state
from public.v_products_status
where is_active
  and expiry_date is not null
  and stock > 0
  and days_to_expiry <= 30;

-- ───────────────────────────────────────────────────────────────────────────
-- v_customer_dues — the receivable book, with the ageing a paper khata cannot
-- produce
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_customer_dues
with (security_invoker = on) as
with last_activity as (
  select
    l.customer_id,
    max(l.occurred_at)                                                     as last_entry_at,
    max(l.occurred_at) filter (where l.entry_type = 'payment_received')    as last_payment_at,
    max(l.occurred_at) filter (where l.entry_type = 'credit_sale')         as last_credit_at
  from public.party_ledger l
  where l.party = 'customer'
  group by l.customer_id
)
select
  c.id,
  c.shop_id,
  c.name,
  c.phone,
  c.address,
  c.credit_limit,
  c.due_balance,
  c.note,
  c.is_active,
  c.created_at,
  la.last_entry_at,
  la.last_payment_at,
  la.last_credit_at,

  case when la.last_payment_at is not null
       then (current_date - la.last_payment_at::date)
       else null end as days_since_payment,

  -- Age from the oldest signal available: if they have never paid, the first
  -- credit sale is the clock that matters.
  coalesce(
    current_date - la.last_payment_at::date,
    current_date - la.last_credit_at::date,
    0
  ) as age_days,

  case
    when c.due_balance <= 0 then 'clear'
    when coalesce(current_date - la.last_payment_at::date,
                  current_date - la.last_credit_at::date, 0) >= 60 then 'd60plus'
    when coalesce(current_date - la.last_payment_at::date,
                  current_date - la.last_credit_at::date, 0) >= 30 then 'd30'
    when coalesce(current_date - la.last_payment_at::date,
                  current_date - la.last_credit_at::date, 0) >= 15 then 'd15'
    when coalesce(current_date - la.last_payment_at::date,
                  current_date - la.last_credit_at::date, 0) >= 7  then 'd7'
    else 'current'
  end as age_bucket,

  (c.credit_limit > 0 and c.due_balance >= c.credit_limit) as over_limit
from public.customers c
left join last_activity la on la.customer_id = c.id;

-- ───────────────────────────────────────────────────────────────────────────
-- v_supplier_dues — the mirror: what the shop owes the মহাজন
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_supplier_dues
with (security_invoker = on) as
with last_activity as (
  select
    l.supplier_id,
    max(l.occurred_at)                                                 as last_entry_at,
    max(l.occurred_at) filter (where l.entry_type = 'payment_made')    as last_payment_at
  from public.party_ledger l
  where l.party = 'supplier'
  group by l.supplier_id
)
select
  s.id, s.shop_id, s.name, s.company, s.phone, s.address,
  s.due_balance, s.note, s.is_active, s.created_at,
  la.last_entry_at,
  la.last_payment_at,
  case when la.last_payment_at is not null
       then (current_date - la.last_payment_at::date)
       else null end as days_since_payment
from public.suppliers s
left join last_activity la on la.supplier_id = s.id;

-- ───────────────────────────────────────────────────────────────────────────
-- v_sales_daily — takings per shop per LOCAL day
--
-- The day boundary is computed in the shop's own timezone. A sale rung up at
-- 11:30 pm in Dhaka belongs to that evening's takings; bucketing on UTC would
-- file it under tomorrow and make every daily closing wrong by one evening.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_sales_daily
with (security_invoker = on) as
select
  s.shop_id,
  (s.sold_at at time zone sh.timezone)::date as day,
  count(*)                                   as sale_count,
  coalesce(sum(s.subtotal), 0)               as gross,
  coalesce(sum(s.discount), 0)               as discount,
  coalesce(sum(s.total), 0)                  as net,
  coalesce(sum(s.paid), 0)                   as collected,
  coalesce(sum(greatest(s.due, 0)), 0)       as credit_given,
  coalesce(sum(ci.cogs), 0)                  as cogs,
  coalesce(sum(s.total), 0) - coalesce(sum(ci.cogs), 0) as gross_profit
from public.sales s
join public.shops sh on sh.id = s.shop_id
left join (
  select si.sale_id, sum(round(si.qty * si.buy_price_snapshot, 2)) as cogs
  from public.sale_items si
  group by si.sale_id
) ci on ci.sale_id = s.id
where s.status = 'completed'
group by s.shop_id, (s.sold_at at time zone sh.timezone)::date;

-- ───────────────────────────────────────────────────────────────────────────
-- v_expenses_daily
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_expenses_daily
with (security_invoker = on) as
select
  e.shop_id,
  (e.spent_at at time zone sh.timezone)::date as day,
  coalesce(sum(e.amount), 0)                  as total,
  count(*)                                    as entry_count
from public.expenses e
join public.shops sh on sh.id = e.shop_id
group by e.shop_id, (e.spent_at at time zone sh.timezone)::date;

-- ───────────────────────────────────────────────────────────────────────────
-- v_product_performance — revenue versus margin
--
-- The comparison that changes buying behaviour. Owners consistently know their
-- top sellers by revenue and are consistently surprised by which products
-- actually carry their margin.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_product_performance
with (security_invoker = on) as
select
  si.shop_id,
  si.product_id,
  max(si.product_name_snapshot)                        as product_name,
  (s.sold_at at time zone sh.timezone)::date           as day,
  sum(si.qty)                                          as qty_sold,
  sum(si.line_total)                                   as revenue,
  sum(round(si.qty * si.buy_price_snapshot, 2))        as cogs,
  sum(si.line_total) - sum(round(si.qty * si.buy_price_snapshot, 2)) as profit,
  case when sum(si.line_total) > 0
       then round(((sum(si.line_total) - sum(round(si.qty * si.buy_price_snapshot, 2)))
                   / sum(si.line_total)) * 100, 1)
       else null end as margin_pct
from public.sale_items si
join public.sales s  on s.id = si.sale_id and s.status = 'completed'
join public.shops sh on sh.id = si.shop_id
group by si.shop_id, si.product_id, (s.sold_at at time zone sh.timezone)::date;

-- ───────────────────────────────────────────────────────────────────────────
-- v_dashboard_today — one row per shop, everything the home screen needs
--
-- The most-loaded screen in the product becomes a single round trip, which is
-- what makes it usable on a 3G connection at 7 am.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_dashboard_today
with (security_invoker = on) as
select
  sh.id as shop_id,
  (now() at time zone sh.timezone)::date as today,

  coalesce(sd.sale_count, 0)   as sales_count,
  coalesce(sd.net, 0)          as sales_total,
  coalesce(sd.collected, 0)    as collected_total,
  coalesce(sd.credit_given, 0) as credit_given,
  coalesce(sd.cogs, 0)         as cogs,
  coalesce(sd.gross_profit, 0) as gross_profit,
  coalesce(ed.total, 0)        as expenses_total,
  coalesce(sd.gross_profit, 0) - coalesce(ed.total, 0) as net_profit,
  coalesce(pc.collected_today, 0) as dues_collected_today,

  coalesce(rc.total_receivable, 0) as total_receivable,
  coalesce(rc.customer_count, 0)   as customers_with_dues,
  coalesce(pay.total_payable, 0)   as total_payable,

  coalesce(ls.low_count, 0)     as low_stock_count,
  coalesce(ls.out_count, 0)     as out_of_stock_count,
  coalesce(ex.expiring_count, 0) as expiring_soon_count,
  coalesce(sv.stock_value, 0)   as stock_value_at_cost
from public.shops sh
left join public.v_sales_daily sd
       on sd.shop_id = sh.id and sd.day = (now() at time zone sh.timezone)::date
left join public.v_expenses_daily ed
       on ed.shop_id = sh.id and ed.day = (now() at time zone sh.timezone)::date
left join (
  select p.shop_id,
         sum(p.amount) as collected_today
  from public.payments p
  join public.shops s2 on s2.id = p.shop_id
  where p.party = 'customer' and p.direction = 'in'
    and (p.paid_at at time zone s2.timezone)::date = (now() at time zone s2.timezone)::date
  group by p.shop_id
) pc on pc.shop_id = sh.id
left join (
  select c.shop_id,
         sum(c.due_balance) as total_receivable,
         count(*)           as customer_count
  from public.customers c
  where c.due_balance > 0
  group by c.shop_id
) rc on rc.shop_id = sh.id
left join (
  select s3.shop_id, sum(s3.due_balance) as total_payable
  from public.suppliers s3
  where s3.due_balance > 0
  group by s3.shop_id
) pay on pay.shop_id = sh.id
left join (
  select p.shop_id,
         count(*) filter (where p.stock > 0 and p.stock <= p.low_stock_threshold) as low_count,
         count(*) filter (where p.stock <= 0)                                     as out_count
  from public.products p
  where p.is_active
  group by p.shop_id
) ls on ls.shop_id = sh.id
left join (
  select p.shop_id, count(*) as expiring_count
  from public.products p
  where p.is_active and p.stock > 0
    and p.expiry_date is not null
    and p.expiry_date - current_date <= 30
  group by p.shop_id
) ex on ex.shop_id = sh.id
left join (
  select p.shop_id, sum(round(p.stock * p.buy_price, 2)) as stock_value
  from public.products p
  where p.is_active and p.stock > 0
  group by p.shop_id
) sv on sv.shop_id = sh.id;

-- ───────────────────────────────────────────────────────────────────────────
-- v_my_shops — the shop switcher, resolved in one call
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_my_shops
with (security_invoker = on) as
select
  sh.id as shop_id,
  sh.name,
  sh.name_bn,
  sh.district,
  sh.currency,
  sh.timezone,
  sh.low_stock_default,
  sh.invoice_prefix,
  sh.receipt_footer,
  sh.phone,
  sh.address,
  sh.logo_url,
  m.role,
  m.status as member_status,
  sub.plan,
  sub.status        as sub_status,
  sub.trial_ends_at,
  sub.current_period_end,
  greatest(0, (sub.trial_ends_at::date - current_date)) as trial_days_left,
  (sub.status = 'active'
    or (sub.status = 'trialing' and sub.trial_ends_at > now())
    or (sub.status = 'past_due' and coalesce(sub.grace_ends_at, now() + interval '7 days') > now())
  ) as can_write
from public.shop_members m
join public.shops sh          on sh.id = m.shop_id
left join public.subscriptions sub on sub.shop_id = sh.id
where m.user_id = auth.uid()
  and m.status = 'active';

-- ───────────────────────────────────────────────────────────────────────────
-- Grants. RLS still applies on the base tables via security_invoker.
-- ───────────────────────────────────────────────────────────────────────────
grant select on public.v_products_status      to authenticated;
grant select on public.v_low_stock            to authenticated;
grant select on public.v_expiring_soon        to authenticated;
grant select on public.v_customer_dues        to authenticated;
grant select on public.v_supplier_dues        to authenticated;
grant select on public.v_sales_daily          to authenticated;
grant select on public.v_expenses_daily       to authenticated;
grant select on public.v_product_performance  to authenticated;
grant select on public.v_dashboard_today      to authenticated;
grant select on public.v_my_shops             to authenticated;


-- === 20260826001000_rpc.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 001000 · RPCs
--
-- Every function here is SECURITY DEFINER, which means RLS is bypassed while it
-- runs: `postgres` owns the tables, and a table owner is not subject to its own
-- policies. So the membership and role assertion at the top of each function is
-- not a convenience — it IS the authorisation check. An unchecked SECURITY
-- DEFINER function is a hole straight through the tenancy model.
--
-- search_path is pinned on every one of them. An unpinned search_path on a
-- definer function is a privilege-escalation vector: a caller able to create a
-- schema could shadow a function name and have it run as the owner.
--
-- The write RPCs take a single jsonb argument rather than fifteen typed
-- parameters, because the offline outbox stores payloads as JSON. One argument
-- means the queued payload IS the call, with no marshalling layer in between to
-- drift out of sync.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Shared guards
-- ───────────────────────────────────────────────────────────────────────────
create or replace function app.assert_member(p_shop uuid, p_min member_role default 'cashier')
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if p_shop is null then
    raise exception 'shop_id is required' using errcode = '22004';
  end if;
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not app.has_min_role(p_shop, p_min) then
    raise exception 'you do not have permission to do this in this shop'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function app.assert_can_write(p_shop uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if not app.shop_can_write(p_shop) then
    raise exception 'this shop''s subscription has ended; records are read-only'
      using errcode = '53400';
  end if;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Serialisers
-- ───────────────────────────────────────────────────────────────────────────
create or replace function app.sale_json(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'sale',  to_jsonb(s),
    'items', coalesce(
               (select jsonb_agg(to_jsonb(si) order by si.created_at)
                  from public.sale_items si where si.sale_id = s.id),
               '[]'::jsonb),
    'customer', (
      select jsonb_build_object(
               'id', c.id, 'name', c.name, 'phone', c.phone,
               'due_balance', c.due_balance, 'credit_limit', c.credit_limit)
        from public.customers c where c.id = s.customer_id)
  )
  from public.sales s
  where s.id = p_sale_id;
$$;

create or replace function app.purchase_json(p_purchase_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'purchase', to_jsonb(p),
    'items', coalesce(
               (select jsonb_agg(to_jsonb(pi) order by pi.created_at)
                  from public.purchase_items pi where pi.purchase_id = p.id),
               '[]'::jsonb),
    'supplier', (
      select jsonb_build_object('id', s.id, 'name', s.name, 'due_balance', s.due_balance)
        from public.suppliers s where s.id = p.supplier_id)
  )
  from public.purchases p
  where p.id = p_purchase_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- create_shop_with_owner
--
-- Atomic, because a signup that fails halfway would otherwise leave an orphan
-- shop with no owner membership — unreachable and undeletable by its creator.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_shop_with_owner(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_shop public.shops;
  v_cat  record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(btrim(payload ->> 'name'), '') = '' then
    raise exception 'the shop needs a name' using errcode = '22004';
  end if;

  insert into public.shops
    (name, name_bn, owner_id, phone, address, district, timezone,
     low_stock_default, invoice_prefix, receipt_footer)
  values
    (btrim(payload ->> 'name'),
     nullif(btrim(coalesce(payload ->> 'name_bn', '')), ''),
     v_uid,
     nullif(btrim(coalesce(payload ->> 'phone', '')), ''),
     nullif(btrim(coalesce(payload ->> 'address', '')), ''),
     nullif(btrim(coalesce(payload ->> 'district', '')), ''),
     coalesce(nullif(payload ->> 'timezone', ''), 'Asia/Dhaka'),
     coalesce((payload ->> 'low_stock_default')::numeric, 5),
     coalesce(nullif(payload ->> 'invoice_prefix', ''), 'MD'),
     nullif(btrim(coalesce(payload ->> 'receipt_footer', '')), ''))
  returning * into v_shop;

  insert into public.shop_members (shop_id, user_id, role, status)
  values (v_shop.id, v_uid, 'owner', 'active');

  insert into public.subscriptions (shop_id, plan, status)
  values (v_shop.id, 'trial', 'trialing');

  -- Default categories, in the order a shopkeeper walks his own shelves.
  for v_cat in
    select * from (values
      ('Rice & Grains',   'চাল ও দানাদার',   'wheat',      10),
      ('Lentils',         'ডাল',             'bean',       20),
      ('Oil & Ghee',      'তেল ও ঘি',        'droplet',    30),
      ('Spices',          'মসলা',            'flame',      40),
      ('Sugar & Salt',    'চিনি ও লবণ',      'cube',       50),
      ('Flour',           'আটা ও ময়দা',     'wheat',      60),
      ('Dairy & Eggs',    'দুধ ও ডিম',       'milk',       70),
      ('Biscuits & Snacks','বিস্কুট ও স্ন্যাকস','cookie',    80),
      ('Beverages',       'পানীয়',           'cup',        90),
      ('Soap & Cleaning', 'সাবান ও পরিষ্কার','sparkles',  100),
      ('Personal Care',   'প্রসাধনী',        'user',      110),
      ('Baby Care',       'শিশু পণ্য',       'baby',      120),
      ('Stationery',      'স্টেশনারি',       'pencil',    130),
      ('Tobacco',         'তামাক',           'ban',       140),
      ('Others',          'অন্যান্য',        'package',   150)
    ) as t(name, name_bn, icon, sort_order)
  loop
    insert into public.categories (shop_id, name, name_bn, icon, sort_order)
    values (v_shop.id, v_cat.name, v_cat.name_bn, v_cat.icon, v_cat.sort_order);
  end loop;

  if coalesce((payload ->> 'seed_catalog')::boolean, false) then
    perform public.seed_starter_catalog(v_shop.id);
  end if;

  insert into public.activity_log (shop_id, user_id, action, entity, entity_id)
  values (v_shop.id, v_uid, 'shop.created', 'shops', v_shop.id);

  return jsonb_build_object('shop', to_jsonb(v_shop));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- create_sale — the single most important function in the system
--
-- Idempotent on client_uuid. The dangerous case is a request that commits in
-- Postgres but whose response never reaches the phone: the device cannot tell
-- that apart from a request that never arrived, so it must retry, and a naive
-- retry would double-decrement stock and double the customer's baki. Because
-- the UUID is generated on the device before the first attempt, the retry is
-- free.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop      uuid := (payload ->> 'shop_id')::uuid;
  v_client    uuid := coalesce(nullif(payload ->> 'client_uuid', '')::uuid, gen_random_uuid());
  v_customer  uuid := nullif(payload ->> 'customer_id', '')::uuid;
  v_discount  numeric(14, 2) := round(coalesce((payload ->> 'discount')::numeric, 0), 2);
  v_paid      numeric(14, 2) := round(coalesce((payload ->> 'paid')::numeric, 0), 2);
  v_method    payment_method := coalesce(nullif(payload ->> 'payment_method', '')::payment_method, 'cash');
  v_sold_at   timestamptz    := coalesce(nullif(payload ->> 'sold_at', '')::timestamptz, now());
  v_subtotal  numeric(14, 2) := 0;
  v_total     numeric(14, 2);
  v_invoice   bigint;
  v_sale      public.sales;
  v_item      jsonb;
  v_qty       numeric(14, 3);
  v_price     numeric(14, 2);
  v_ldisc     numeric(14, 2);
begin
  perform app.assert_member(v_shop, 'cashier');

  -- Idempotency, checked before anything is written.
  select * into v_sale
    from public.sales
   where shop_id = v_shop and client_uuid = v_client;
  if found then
    return app.sale_json(v_sale.id);
  end if;

  perform app.assert_can_write(v_shop);

  if payload -> 'items' is null
     or jsonb_typeof(payload -> 'items') <> 'array'
     or jsonb_array_length(payload -> 'items') = 0 then
    raise exception 'a sale needs at least one item' using errcode = '22004';
  end if;

  if v_customer is not null
     and not exists (select 1 from public.customers
                      where id = v_customer and shop_id = v_shop) then
    raise exception 'that customer is not in this shop' using errcode = '23503';
  end if;

  for v_item in select value from jsonb_array_elements(payload -> 'items') loop
    v_qty   := (v_item ->> 'qty')::numeric;
    v_price := round((v_item ->> 'unit_price')::numeric, 2);
    v_ldisc := round(coalesce((v_item ->> 'line_discount')::numeric, 0), 2);

    if v_qty is null or v_qty <= 0 then
      raise exception 'every line needs a quantity above zero' using errcode = '22004';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'every line needs a price' using errcode = '22004';
    end if;

    v_subtotal := v_subtotal + (round(v_qty * v_price, 2) - v_ldisc);
  end loop;

  v_total := greatest(round(v_subtotal - v_discount, 2), 0);

  -- A walk-in cannot overpay: the UI computes change and sends the bill amount.
  -- A khata customer CAN, and the surplus is applied against their older baki
  -- by the sales → party_ledger trigger, which is what happens on payday.
  if v_customer is null then
    v_paid := least(v_paid, v_total);
  end if;

  v_invoice := app.next_counter(v_shop, 'sale');

  insert into public.sales
    (shop_id, invoice_no, customer_id, subtotal, discount, total, paid,
     payment_method, note, sold_at, created_by, client_uuid)
  values
    (v_shop, v_invoice, v_customer, v_subtotal, v_discount, v_total, v_paid,
     v_method, nullif(btrim(coalesce(payload ->> 'note', '')), ''),
     v_sold_at, auth.uid(), v_client)
  returning * into v_sale;

  for v_item in select value from jsonb_array_elements(payload -> 'items') loop
    insert into public.sale_items
      (sale_id, shop_id, product_id, product_name_snapshot,
       qty, unit, unit_price, buy_price_snapshot, line_discount)
    values
      (v_sale.id, v_shop,
       nullif(v_item ->> 'product_id', '')::uuid,
       nullif(btrim(coalesce(v_item ->> 'name', '')), ''),
       (v_item ->> 'qty')::numeric,
       nullif(v_item ->> 'unit', '')::unit_type,
       round((v_item ->> 'unit_price')::numeric, 2),
       nullif(v_item ->> 'buy_price', '')::numeric,
       round(coalesce((v_item ->> 'line_discount')::numeric, 0), 2));
  end loop;

  return app.sale_json(v_sale.id);

exception
  when unique_violation then
    -- Two retries raced and the other one won. Hand back its result.
    select * into v_sale
      from public.sales
     where shop_id = v_shop and client_uuid = v_client;
    if found then
      return app.sale_json(v_sale.id);
    end if;
    raise;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- create_purchase — goods in from a distributor (মাল তোলা)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop     uuid := (payload ->> 'shop_id')::uuid;
  v_client   uuid := coalesce(nullif(payload ->> 'client_uuid', '')::uuid, gen_random_uuid());
  v_supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  v_discount numeric(14, 2) := round(coalesce((payload ->> 'discount')::numeric, 0), 2);
  v_paid     numeric(14, 2) := round(coalesce((payload ->> 'paid')::numeric, 0), 2);
  v_at       timestamptz    := coalesce(nullif(payload ->> 'purchased_at', '')::timestamptz, now());
  v_subtotal numeric(14, 2) := 0;
  v_total    numeric(14, 2);
  v_invoice  bigint;
  v_purchase public.purchases;
  v_item     jsonb;
  v_qty      numeric(14, 3);
  v_cost     numeric(14, 2);
begin
  perform app.assert_member(v_shop, 'manager');

  select * into v_purchase
    from public.purchases
   where shop_id = v_shop and client_uuid = v_client;
  if found then
    return app.purchase_json(v_purchase.id);
  end if;

  perform app.assert_can_write(v_shop);

  if payload -> 'items' is null
     or jsonb_typeof(payload -> 'items') <> 'array'
     or jsonb_array_length(payload -> 'items') = 0 then
    raise exception 'record at least one item that came in' using errcode = '22004';
  end if;

  if v_supplier is not null
     and not exists (select 1 from public.suppliers
                      where id = v_supplier and shop_id = v_shop) then
    raise exception 'that supplier is not in this shop' using errcode = '23503';
  end if;

  for v_item in select value from jsonb_array_elements(payload -> 'items') loop
    v_qty  := (v_item ->> 'qty')::numeric;
    v_cost := round(coalesce((v_item ->> 'unit_cost')::numeric, 0), 2);
    if v_qty is null or v_qty <= 0 then
      raise exception 'every line needs a quantity above zero' using errcode = '22004';
    end if;
    v_subtotal := v_subtotal + round(v_qty * v_cost, 2);
  end loop;

  v_total   := greatest(round(v_subtotal - v_discount, 2), 0);
  v_invoice := app.next_counter(v_shop, 'purchase');

  insert into public.purchases
    (shop_id, invoice_no, supplier_id, supplier_ref, subtotal, discount, total,
     paid, note, purchased_at, created_by, client_uuid)
  values
    (v_shop, v_invoice, v_supplier,
     nullif(btrim(coalesce(payload ->> 'supplier_ref', '')), ''),
     v_subtotal, v_discount, v_total, v_paid,
     nullif(btrim(coalesce(payload ->> 'note', '')), ''),
     v_at, auth.uid(), v_client)
  returning * into v_purchase;

  for v_item in select value from jsonb_array_elements(payload -> 'items') loop
    insert into public.purchase_items
      (purchase_id, shop_id, product_id, qty, unit, unit_cost)
    values
      (v_purchase.id, v_shop,
       (v_item ->> 'product_id')::uuid,
       (v_item ->> 'qty')::numeric,
       coalesce(nullif(v_item ->> 'unit', '')::unit_type,
                (select unit from public.products where id = (v_item ->> 'product_id')::uuid)),
       round(coalesce((v_item ->> 'unit_cost')::numeric, 0), 2));
  end loop;

  return app.purchase_json(v_purchase.id);

exception
  when unique_violation then
    select * into v_purchase
      from public.purchases
     where shop_id = v_shop and client_uuid = v_client;
    if found then
      return app.purchase_json(v_purchase.id);
    end if;
    raise;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- record_payment — collecting a baki, or paying the মহাজন
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop      uuid := (payload ->> 'shop_id')::uuid;
  v_client    uuid := coalesce(nullif(payload ->> 'client_uuid', '')::uuid, gen_random_uuid());
  v_party     party_type        := (payload ->> 'party')::party_type;
  v_direction payment_direction := coalesce(nullif(payload ->> 'direction', '')::payment_direction,
                                            case when (payload ->> 'party') = 'customer'
                                                 then 'in'::payment_direction
                                                 else 'out'::payment_direction end);
  v_amount    numeric(14, 2) := round(coalesce((payload ->> 'amount')::numeric, 0), 2);
  v_customer  uuid := nullif(payload ->> 'customer_id', '')::uuid;
  v_supplier  uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  v_payment   public.payments;
  v_balance   numeric(14, 2);
begin
  -- Paying a supplier moves money out of the shop; that is a manager decision.
  -- Collecting a baki is the cashier's daily work.
  if v_party = 'supplier' or v_direction = 'out' then
    perform app.assert_member(v_shop, 'manager');
  else
    perform app.assert_member(v_shop, 'cashier');
  end if;

  select * into v_payment
    from public.payments
   where shop_id = v_shop and client_uuid = v_client;
  if found then
    return jsonb_build_object('payment', to_jsonb(v_payment), 'duplicate', true);
  end if;

  perform app.assert_can_write(v_shop);

  if v_amount <= 0 then
    raise exception 'enter an amount above zero' using errcode = '22004';
  end if;

  if v_party = 'customer' then
    if v_customer is null then
      raise exception 'pick a customer' using errcode = '22004';
    end if;
    if not exists (select 1 from public.customers where id = v_customer and shop_id = v_shop) then
      raise exception 'that customer is not in this shop' using errcode = '23503';
    end if;
    v_supplier := null;
  else
    if v_supplier is null then
      raise exception 'pick a supplier' using errcode = '22004';
    end if;
    if not exists (select 1 from public.suppliers where id = v_supplier and shop_id = v_shop) then
      raise exception 'that supplier is not in this shop' using errcode = '23503';
    end if;
    v_customer := null;
  end if;

  insert into public.payments
    (shop_id, party, customer_id, supplier_id, direction, amount, method,
     sale_id, purchase_id, note, paid_at, created_by, client_uuid)
  values
    (v_shop, v_party, v_customer, v_supplier, v_direction, v_amount,
     coalesce(nullif(payload ->> 'method', '')::payment_method, 'cash'),
     nullif(payload ->> 'sale_id', '')::uuid,
     nullif(payload ->> 'purchase_id', '')::uuid,
     nullif(btrim(coalesce(payload ->> 'note', '')), ''),
     coalesce(nullif(payload ->> 'paid_at', '')::timestamptz, now()),
     auth.uid(), v_client)
  returning * into v_payment;

  select case when v_party = 'customer'
              then (select due_balance from public.customers where id = v_customer)
              else (select due_balance from public.suppliers where id = v_supplier)
         end into v_balance;

  return jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'balance_after', v_balance,
    'duplicate', false);

exception
  when unique_violation then
    select * into v_payment
      from public.payments
     where shop_id = v_shop and client_uuid = v_client;
    if found then
      return jsonb_build_object('payment', to_jsonb(v_payment), 'duplicate', true);
    end if;
    raise;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- adjust_stock — the shrinkage audit trail
--
-- The reason is mandatory. "Stock went down" is not information; "4 kg damaged
-- in the monsoon" and "4 kg unaccounted for" are two completely different
-- conversations, and the whole value of the stock ledger is telling them apart.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.adjust_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop    uuid := (payload ->> 'shop_id')::uuid;
  v_client  uuid := coalesce(nullif(payload ->> 'client_uuid', '')::uuid, gen_random_uuid());
  v_product uuid := (payload ->> 'product_id')::uuid;
  v_delta   numeric(14, 3) := (payload ->> 'delta')::numeric;
  v_reason  stock_reason   := (payload ->> 'reason')::stock_reason;
  v_row     public.stock_ledger;
begin
  perform app.assert_member(v_shop, 'manager');

  select * into v_row
    from public.stock_ledger
   where shop_id = v_shop and ref_table = 'manual' and ref_id = v_client;
  if found then
    return jsonb_build_object('entry', to_jsonb(v_row), 'duplicate', true);
  end if;

  perform app.assert_can_write(v_shop);

  if v_delta is null or v_delta = 0 then
    raise exception 'enter how much to add or remove' using errcode = '22004';
  end if;
  if v_reason is null then
    raise exception 'choose a reason for the change' using errcode = '22004';
  end if;
  if not exists (select 1 from public.products where id = v_product and shop_id = v_shop) then
    raise exception 'that product is not in this shop' using errcode = '23503';
  end if;

  insert into public.stock_ledger
    (shop_id, product_id, delta, reason, ref_table, ref_id, note, created_by)
  values
    (v_shop, v_product, v_delta, v_reason, 'manual', v_client,
     nullif(btrim(coalesce(payload ->> 'note', '')), ''), auth.uid())
  returning * into v_row;

  return jsonb_build_object('entry', to_jsonb(v_row), 'duplicate', false);

exception
  when unique_violation then
    select * into v_row
      from public.stock_ledger
     where shop_id = v_shop and ref_table = 'manual' and ref_id = v_client;
    if found then
      return jsonb_build_object('entry', to_jsonb(v_row), 'duplicate', true);
    end if;
    raise;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- create_expense
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop   uuid := (payload ->> 'shop_id')::uuid;
  v_client uuid := coalesce(nullif(payload ->> 'client_uuid', '')::uuid, gen_random_uuid());
  v_row    public.expenses;
begin
  perform app.assert_member(v_shop, 'manager');

  select * into v_row from public.expenses
   where shop_id = v_shop and client_uuid = v_client;
  if found then
    return jsonb_build_object('expense', to_jsonb(v_row), 'duplicate', true);
  end if;

  perform app.assert_can_write(v_shop);

  if coalesce((payload ->> 'amount')::numeric, 0) <= 0 then
    raise exception 'enter an amount above zero' using errcode = '22004';
  end if;

  insert into public.expenses (shop_id, category, amount, note, spent_at, created_by, client_uuid)
  values (v_shop,
          coalesce(nullif(payload ->> 'category', '')::expense_category, 'other'),
          round((payload ->> 'amount')::numeric, 2),
          nullif(btrim(coalesce(payload ->> 'note', '')), ''),
          coalesce(nullif(payload ->> 'spent_at', '')::timestamptz, now()),
          auth.uid(), v_client)
  returning * into v_row;

  return jsonb_build_object('expense', to_jsonb(v_row), 'duplicate', false);

exception
  when unique_violation then
    select * into v_row from public.expenses
     where shop_id = v_shop and client_uuid = v_client;
    if found then
      return jsonb_build_object('expense', to_jsonb(v_row), 'duplicate', true);
    end if;
    raise;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- void_sale — owner only, and nothing is deleted
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.sales;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'that sale no longer exists' using errcode = 'P0002';
  end if;

  perform app.assert_member(v_sale.shop_id, 'owner');

  if v_sale.status = 'void' then
    return app.sale_json(v_sale.id);  -- already voided; idempotent
  end if;

  -- The triggers on sales do the reversing work: compensating stock rows and a
  -- negative party_ledger entry. This function only flips the flag.
  update public.sales
     set status = 'void',
         void_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_sale_id;

  insert into public.activity_log (shop_id, user_id, action, entity, entity_id, meta)
  values (v_sale.shop_id, auth.uid(), 'sale.voided', 'sales', p_sale_id,
          jsonb_build_object('invoice_no', v_sale.invoice_no,
                             'total', v_sale.total,
                             'reason', p_reason));

  return app.sale_json(p_sale_id);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- set_opening_balance — migrating a paper khata page in one sitting
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.set_opening_balance(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop   uuid := (payload ->> 'shop_id')::uuid;
  v_client uuid := coalesce(nullif(payload ->> 'client_uuid', '')::uuid, gen_random_uuid());
  v_party  party_type := (payload ->> 'party')::party_type;
  v_amount numeric(14, 2) := round(coalesce((payload ->> 'amount')::numeric, 0), 2);
  v_row    public.party_ledger;
begin
  perform app.assert_member(v_shop, 'manager');

  select * into v_row from public.party_ledger
   where shop_id = v_shop and ref_table = 'manual' and ref_id = v_client;
  if found then
    return jsonb_build_object('entry', to_jsonb(v_row), 'duplicate', true);
  end if;

  perform app.assert_can_write(v_shop);

  if v_amount = 0 then
    raise exception 'enter the amount already owed' using errcode = '22004';
  end if;

  insert into public.party_ledger
    (shop_id, party, customer_id, supplier_id, entry_type, amount,
     ref_table, ref_id, note, occurred_at, created_by)
  values
    (v_shop, v_party,
     case when v_party = 'customer' then (payload ->> 'customer_id')::uuid end,
     case when v_party = 'supplier' then (payload ->> 'supplier_id')::uuid end,
     coalesce(nullif(payload ->> 'entry_type', '')::ledger_entry_type, 'opening_balance'),
     v_amount, 'manual', v_client,
     coalesce(nullif(btrim(coalesce(payload ->> 'note', '')), ''), 'পুরনো খাতার বাকি'),
     coalesce(nullif(payload ->> 'occurred_at', '')::timestamptz, now()),
     auth.uid())
  returning * into v_row;

  return jsonb_build_object('entry', to_jsonb(v_row), 'duplicate', false);

exception
  when unique_violation then
    select * into v_row from public.party_ledger
     where shop_id = v_shop and ref_table = 'manual' and ref_id = v_client;
    if found then
      return jsonb_build_object('entry', to_jsonb(v_row), 'duplicate', true);
    end if;
    raise;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Staff lifecycle
--
-- Turnover among shop helpers is high, so inviting must take a minute and
-- revoking must take one tap.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.invite_member(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop  uuid := (payload ->> 'shop_id')::uuid;
  v_email text := lower(btrim(coalesce(payload ->> 'email', '')));
  v_role  member_role := coalesce(nullif(payload ->> 'role', '')::member_role, 'cashier');
  v_token text;
  v_row   public.shop_members;
  v_user  uuid;
begin
  perform app.assert_member(v_shop, 'owner');

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'enter a valid email address' using errcode = '22004';
  end if;
  if v_role = 'owner' then
    raise exception 'a shop has one owner; invite a manager or a cashier'
      using errcode = '22004';
  end if;

  -- If they already have an account, bind the membership straight away.
  select id into v_user from auth.users where lower(email) = v_email;

  if v_user is not null then
    if exists (select 1 from public.shop_members
                where shop_id = v_shop and user_id = v_user) then
      update public.shop_members
         set role = v_role, status = 'active'
       where shop_id = v_shop and user_id = v_user
       returning * into v_row;
    else
      insert into public.shop_members (shop_id, user_id, role, status, invited_email, invited_by)
      values (v_shop, v_user, v_role, 'active', v_email, auth.uid())
      returning * into v_row;
    end if;

    return jsonb_build_object('member', to_jsonb(v_row), 'joined_immediately', true);
  end if;

  -- 64 hex characters from two built-in v4 UUIDs. Deliberately not derived from
  -- the email: a token that can be reconstructed from a guessable input is not a
  -- token. `gen_random_uuid` is core Postgres, so this needs no extension.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.shop_members
    (shop_id, user_id, role, status, invited_email, invite_token, invited_by)
  values
    (v_shop, null, v_role, 'invited', v_email, v_token, auth.uid())
  on conflict (shop_id, lower(invited_email)) where status = 'invited'
  do update set role = v_role, invite_token = v_token, invited_by = auth.uid()
  returning * into v_row;

  return jsonb_build_object('member', to_jsonb(v_row),
                            'joined_immediately', false,
                            'invite_token', v_token);
end;
$$;

create or replace function public.accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_row   public.shop_members;
begin
  if v_uid is null then
    raise exception 'sign in first, then open the invite again' using errcode = '42501';
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;

  select * into v_row
    from public.shop_members
   where invite_token = p_token and status = 'invited';
  if not found then
    raise exception 'this invite has already been used or is no longer valid'
      using errcode = 'P0002';
  end if;

  if lower(v_row.invited_email) <> v_email then
    raise exception 'this invite was sent to a different email address'
      using errcode = '42501';
  end if;

  update public.shop_members
     set user_id = v_uid, status = 'active', invite_token = null
   where id = v_row.id
   returning * into v_row;

  return jsonb_build_object('member', to_jsonb(v_row));
end;
$$;

create or replace function public.set_member_status(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop   uuid := (payload ->> 'shop_id')::uuid;
  v_member uuid := (payload ->> 'member_id')::uuid;
  v_status member_status := nullif(payload ->> 'status', '')::member_status;
  v_role   member_role   := nullif(payload ->> 'role', '')::member_role;
  v_row    public.shop_members;
begin
  perform app.assert_member(v_shop, 'owner');

  select * into v_row from public.shop_members where id = v_member and shop_id = v_shop;
  if not found then
    raise exception 'that team member is not in this shop' using errcode = 'P0002';
  end if;

  -- The last active owner cannot lock themselves out of their own shop.
  if v_row.role = 'owner'
     and (v_status = 'disabled' or (v_role is not null and v_role <> 'owner'))
     and (select count(*) from public.shop_members
           where shop_id = v_shop and role = 'owner' and status = 'active') <= 1
  then
    raise exception 'a shop needs at least one active owner' using errcode = '22004';
  end if;

  update public.shop_members
     set status = coalesce(v_status, status),
         role   = coalesce(v_role, role)
   where id = v_member
   returning * into v_row;

  return jsonb_build_object('member', to_jsonb(v_row));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Recalculation — the operational safety net
--
-- The cached balances are only as good as the triggers that maintain them.
-- These rebuild each one from its ledger, which means a trigger bug is
-- recoverable rather than corrupting.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.recalc_product_stock(p_product_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop  uuid;
  v_stock numeric(14, 3);
begin
  select shop_id into v_shop from public.products where id = p_product_id;
  if v_shop is null then
    raise exception 'that product no longer exists' using errcode = 'P0002';
  end if;
  perform app.assert_member(v_shop, 'manager');

  select coalesce(sum(delta), 0) into v_stock
    from public.stock_ledger where product_id = p_product_id;

  perform set_config('app.derived_write', 'on', true);
  update public.products set stock = v_stock where id = p_product_id;
  return v_stock;
end;
$$;

create or replace function public.recalc_customer_balance(p_customer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop uuid;
  v_bal  numeric(14, 2);
begin
  select shop_id into v_shop from public.customers where id = p_customer_id;
  if v_shop is null then
    raise exception 'that customer no longer exists' using errcode = 'P0002';
  end if;
  perform app.assert_member(v_shop, 'manager');

  select coalesce(sum(amount), 0) into v_bal
    from public.party_ledger where customer_id = p_customer_id and party = 'customer';

  perform set_config('app.derived_write', 'on', true);
  update public.customers set due_balance = v_bal where id = p_customer_id;
  return v_bal;
end;
$$;

create or replace function public.recalc_supplier_balance(p_supplier_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop uuid;
  v_bal  numeric(14, 2);
begin
  select shop_id into v_shop from public.suppliers where id = p_supplier_id;
  if v_shop is null then
    raise exception 'that supplier no longer exists' using errcode = 'P0002';
  end if;
  perform app.assert_member(v_shop, 'manager');

  select coalesce(sum(amount), 0) into v_bal
    from public.party_ledger where supplier_id = p_supplier_id and party = 'supplier';

  perform set_config('app.derived_write', 'on', true);
  update public.suppliers set due_balance = v_bal where id = p_supplier_id;
  return v_bal;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- daily_closing — reconciles what should be in the drawer against what is
--
-- Cash in the drawer is not profit, and the gap between the two is where a
-- shopkeeper's suspicion lives. This names the difference instead of leaving it
-- as a feeling.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.daily_closing(
  p_shop_id      uuid,
  p_day          date    default null,
  p_counted_cash numeric default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_tz            text;
  v_day           date;
  v_cash_sales    numeric(14, 2);
  v_digital_sales numeric(14, 2);
  v_credit_given  numeric(14, 2);
  v_dues_cash     numeric(14, 2);
  v_dues_digital  numeric(14, 2);
  v_paid_out      numeric(14, 2);
  v_expenses      numeric(14, 2);
  v_sales_total   numeric(14, 2);
  v_cogs          numeric(14, 2);
  v_expected      numeric(14, 2);
begin
  perform app.assert_member(p_shop_id, 'manager');

  select timezone into v_tz from public.shops where id = p_shop_id;
  v_day := coalesce(p_day, (now() at time zone v_tz)::date);

  select coalesce(sum(s.total), 0),
         coalesce(sum(round(ci.cogs, 2)), 0),
         coalesce(sum(s.paid) filter (where s.payment_method = 'cash'), 0),
         coalesce(sum(s.paid) filter (where s.payment_method <> 'cash'), 0),
         coalesce(sum(greatest(s.due, 0)), 0)
    into v_sales_total, v_cogs, v_cash_sales, v_digital_sales, v_credit_given
    from public.sales s
    left join (
      select si.sale_id, sum(round(si.qty * si.buy_price_snapshot, 2)) as cogs
        from public.sale_items si group by si.sale_id
    ) ci on ci.sale_id = s.id
   where s.shop_id = p_shop_id
     and s.status = 'completed'
     and (s.sold_at at time zone v_tz)::date = v_day;

  select coalesce(sum(amount) filter (where method = 'cash' and direction = 'in'), 0),
         coalesce(sum(amount) filter (where method <> 'cash' and direction = 'in'), 0),
         coalesce(sum(amount) filter (where direction = 'out'), 0)
    into v_dues_cash, v_dues_digital, v_paid_out
    from public.payments
   where shop_id = p_shop_id
     and (paid_at at time zone v_tz)::date = v_day;

  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses
   where shop_id = p_shop_id
     and (spent_at at time zone v_tz)::date = v_day;

  v_expected := v_cash_sales + v_dues_cash - v_paid_out - v_expenses;

  return jsonb_build_object(
    'day',              v_day,
    'sales_total',      v_sales_total,
    'cogs',             v_cogs,
    'gross_profit',     v_sales_total - v_cogs,
    'cash_from_sales',  v_cash_sales,
    'digital_from_sales', v_digital_sales,
    'credit_given',     v_credit_given,
    'dues_collected_cash',    v_dues_cash,
    'dues_collected_digital', v_dues_digital,
    'paid_to_suppliers', v_paid_out,
    'expenses',         v_expenses,
    'net_profit',       v_sales_total - v_cogs - v_expenses,
    'expected_cash',    v_expected,
    'counted_cash',     p_counted_cash,
    'variance',         case when p_counted_cash is null then null
                             else round(p_counted_cash - v_expected, 2) end
  );
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Grants. Only the public.* functions are callable from the browser; the app.*
-- helpers stay private because they are the RLS machinery itself.
-- ───────────────────────────────────────────────────────────────────────────
revoke all on function app.assert_member(uuid, member_role) from public;
revoke all on function app.assert_can_write(uuid)           from public;
revoke all on function app.sale_json(uuid)                  from public;
revoke all on function app.purchase_json(uuid)              from public;

grant execute on function app.assert_member(uuid, member_role) to authenticated;
grant execute on function app.assert_can_write(uuid)           to authenticated;

grant execute on function public.create_shop_with_owner(jsonb)      to authenticated;
grant execute on function public.create_sale(jsonb)                 to authenticated;
grant execute on function public.create_purchase(jsonb)             to authenticated;
grant execute on function public.record_payment(jsonb)              to authenticated;
grant execute on function public.adjust_stock(jsonb)                to authenticated;
grant execute on function public.create_expense(jsonb)              to authenticated;
grant execute on function public.void_sale(uuid, text)              to authenticated;
grant execute on function public.set_opening_balance(jsonb)         to authenticated;
grant execute on function public.invite_member(jsonb)               to authenticated;
grant execute on function public.accept_invite(text)                to authenticated;
grant execute on function public.set_member_status(jsonb)           to authenticated;
grant execute on function public.recalc_product_stock(uuid)         to authenticated;
grant execute on function public.recalc_customer_balance(uuid)      to authenticated;
grant execute on function public.recalc_supplier_balance(uuid)      to authenticated;
grant execute on function public.daily_closing(uuid, date, numeric) to authenticated;


-- === 20260826001100_rls.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 001100 · Row-level security
--
-- Read this file as the authorisation spec. There is no application server in
-- this architecture — PostgREST talks to Postgres directly with the caller's JWT
-- — so these policies ARE the backend's access control. Nothing else stands
-- between a browser and the table.
--
-- Three rules held to throughout:
--
-- 1. No policy anywhere says USING (true). Every single one resolves through
--    app.is_shop_member() or app.has_min_role(), so a shop can only ever see its
--    own rows even if the client forgets .eq('shop_id', …).
--
-- 2. The transaction tables (sales, purchases, payments, expenses) and BOTH
--    ledgers get SELECT only. Every write goes through the SECURITY DEFINER RPCs
--    in 001000. That is not bureaucracy: the ledger triggers run with the
--    INVOKER's rights, so allowing direct inserts would mean granting cashiers
--    insert on stock_ledger and party_ledger too — and a role that can insert
--    into party_ledger directly can hand itself any balance it likes. Funnelling
--    writes through definer functions closes that hole completely and gives us
--    idempotency and validation in the same move.
--
-- 3. The ledgers are never UPDATE-able or DELETE-able by anyone. No policy is
--    written for those commands, which means Postgres denies them. That is what
--    makes the khata evidence a shopkeeper can show a customer rather than notes
--    he could have edited.
--
-- RLS denies by default once enabled: a command with no matching policy fails.
-- So the absence of a policy below is a deliberate decision, not an oversight.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles      enable row level security;
alter table public.shops         enable row level security;
alter table public.shop_members  enable row level security;
alter table public.subscriptions enable row level security;
alter table public.shop_counters enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.customers     enable row level security;
alter table public.suppliers     enable row level security;
alter table public.sales         enable row level security;
alter table public.sale_items    enable row level security;
alter table public.purchases     enable row level security;
alter table public.purchase_items enable row level security;
alter table public.payments      enable row level security;
alter table public.expenses      enable row level security;
alter table public.stock_ledger  enable row level security;
alter table public.party_ledger  enable row level security;
alter table public.activity_log  enable row level security;

-- A note on FORCE ROW LEVEL SECURITY, which is deliberately NOT used here.
-- It would make even the table owner subject to these policies — appealing at
-- first glance, but the policies are written `to authenticated`, and the ledger
-- triggers run as the owner inside the definer RPCs. Under FORCE, no policy
-- would match that context and every legitimate ledger insert would fail. The
-- protection FORCE is reaching for is provided instead by the absence of any
-- INSERT/UPDATE/DELETE policy plus trg_guard_derived_columns.

-- ───────────────────────────────────────────────────────────────────────────
-- profiles
--
-- A member can read the profiles of people in the same shop, because the team
-- screen and "sold by Sumon" on a receipt need a name, not a UUID.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists profiles_select_self_or_shopmate on public.profiles;
create policy profiles_select_self_or_shopmate on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
        from public.shop_members mine
        join public.shop_members theirs on theirs.shop_id = mine.shop_id
       where mine.user_id   = auth.uid()
         and mine.status    = 'active'
         and theirs.user_id = public.profiles.id
    )
  );

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ───────────────────────────────────────────────────────────────────────────
-- shops
--
-- No INSERT policy: shops are born through create_shop_with_owner(), which
-- creates the membership and the subscription in the same transaction. A raw
-- insert would produce a shop nobody is a member of — invisible and
-- unrecoverable to the person who just created it.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists shops_select_member on public.shops;
create policy shops_select_member on public.shops
  for select to authenticated
  using (app.is_shop_member(id));

drop policy if exists shops_update_manager on public.shops;
create policy shops_update_manager on public.shops
  for update to authenticated
  using (app.has_min_role(id, 'manager'))
  with check (app.has_min_role(id, 'manager'));

drop policy if exists shops_delete_owner on public.shops;
create policy shops_delete_owner on public.shops
  for delete to authenticated
  using (app.has_min_role(id, 'owner'));

-- ───────────────────────────────────────────────────────────────────────────
-- shop_members
--
-- This is the table whose policy would recurse if the helpers were not
-- SECURITY DEFINER. See the long note at the bottom of 000300.
--
-- Writes are owner-only and in practice go through invite_member() /
-- set_member_status(), which also enforce "a shop keeps at least one owner".
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists shop_members_select_member on public.shop_members;
create policy shop_members_select_member on public.shop_members
  for select to authenticated
  using (app.is_shop_member(shop_id) or user_id = auth.uid());

drop policy if exists shop_members_write_owner on public.shop_members;
create policy shop_members_write_owner on public.shop_members
  for all to authenticated
  using (app.has_min_role(shop_id, 'owner'))
  with check (app.has_min_role(shop_id, 'owner'));

-- ───────────────────────────────────────────────────────────────────────────
-- subscriptions — readable by the shop, writable only by billing
--
-- No write policy for `authenticated` at all. Plan changes arrive from the
-- payment webhook using the service role, which bypasses RLS. A client that
-- could UPDATE this row could grant itself a free subscription.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists subscriptions_select_member on public.subscriptions;
create policy subscriptions_select_member on public.subscriptions
  for select to authenticated
  using (app.is_shop_member(shop_id));

-- ───────────────────────────────────────────────────────────────────────────
-- shop_counters — no policies at all, deliberately
--
-- RLS is enabled and nothing is granted, so `authenticated` cannot read or
-- write it. The only access path is app.next_counter(), which is definer-owned.
-- Exposing the counter would let a client reserve or skip invoice numbers.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- categories
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists categories_select_member on public.categories;
create policy categories_select_member on public.categories
  for select to authenticated
  using (app.is_shop_member(shop_id));

drop policy if exists categories_insert_manager on public.categories;
create policy categories_insert_manager on public.categories
  for insert to authenticated
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));

drop policy if exists categories_update_manager on public.categories;
create policy categories_update_manager on public.categories
  for update to authenticated
  using (app.has_min_role(shop_id, 'manager'))
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));

drop policy if exists categories_delete_manager on public.categories;
create policy categories_delete_manager on public.categories
  for delete to authenticated
  using (app.has_min_role(shop_id, 'manager'));

-- ───────────────────────────────────────────────────────────────────────────
-- products
--
-- Cashiers read the catalogue and cannot touch it: prices are the owner's
-- decision, and "the helper changed a price" is a category of dispute this
-- product exists to eliminate.
--
-- The stock column is additionally protected by trg_products_guard_derived,
-- because RLS filters rows and cannot filter columns.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists products_select_member on public.products;
create policy products_select_member on public.products
  for select to authenticated
  using (app.is_shop_member(shop_id));

drop policy if exists products_insert_manager on public.products;
create policy products_insert_manager on public.products
  for insert to authenticated
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));

drop policy if exists products_update_manager on public.products;
create policy products_update_manager on public.products
  for update to authenticated
  using (app.has_min_role(shop_id, 'manager'))
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));

-- Owner-only, and the UI offers "deactivate" first. A product with sales history
-- should be archived, not removed.
drop policy if exists products_delete_owner on public.products;
create policy products_delete_owner on public.products
  for delete to authenticated
  using (app.has_min_role(shop_id, 'owner'));

-- ───────────────────────────────────────────────────────────────────────────
-- customers
--
-- Cashiers CAN create and edit customers. This is a considered trade against
-- the tighter alternative: the moment a new face asks for baki is exactly when
-- the record has to be created, and if the helper cannot do it he will write it
-- on paper instead — which is the entire problem we are here to solve.
--
-- The cost is that a cashier can also change credit_limit, which RLS cannot
-- prevent (column-level filtering is not something policies can express). The
-- UI gates that field at manager level, and every change lands in activity_log,
-- so it is visible rather than silent. due_balance itself is unreachable:
-- trg_customers_guard_derived blocks it for everyone.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists customers_select_member on public.customers;
create policy customers_select_member on public.customers
  for select to authenticated
  using (app.is_shop_member(shop_id));

drop policy if exists customers_insert_cashier on public.customers;
create policy customers_insert_cashier on public.customers
  for insert to authenticated
  with check (app.is_shop_member(shop_id) and app.shop_can_write(shop_id));

drop policy if exists customers_update_cashier on public.customers;
create policy customers_update_cashier on public.customers
  for update to authenticated
  using (app.is_shop_member(shop_id))
  with check (app.is_shop_member(shop_id) and app.shop_can_write(shop_id));

-- Never by a cashier, and the UI will refuse while a balance is outstanding.
drop policy if exists customers_delete_owner on public.customers;
create policy customers_delete_owner on public.customers
  for delete to authenticated
  using (app.has_min_role(shop_id, 'owner'));

-- ───────────────────────────────────────────────────────────────────────────
-- suppliers — manager and up throughout. A cashier has no business with the
-- distributor relationship.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists suppliers_select_member on public.suppliers;
create policy suppliers_select_member on public.suppliers
  for select to authenticated
  using (app.is_shop_member(shop_id));

drop policy if exists suppliers_insert_manager on public.suppliers;
create policy suppliers_insert_manager on public.suppliers
  for insert to authenticated
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));

drop policy if exists suppliers_update_manager on public.suppliers;
create policy suppliers_update_manager on public.suppliers
  for update to authenticated
  using (app.has_min_role(shop_id, 'manager'))
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));

drop policy if exists suppliers_delete_owner on public.suppliers;
create policy suppliers_delete_owner on public.suppliers
  for delete to authenticated
  using (app.has_min_role(shop_id, 'owner'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Transactions — SELECT only from the client
--
-- create_sale(), create_purchase(), record_payment(), create_expense() and
-- void_sale() are the write path. See rule 2 in the header for why.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists sales_select_member on public.sales;
create policy sales_select_member on public.sales
  for select to authenticated
  using (app.is_shop_member(shop_id));

drop policy if exists sale_items_select_member on public.sale_items;
create policy sale_items_select_member on public.sale_items
  for select to authenticated
  using (app.is_shop_member(shop_id));

drop policy if exists purchases_select_manager on public.purchases;
create policy purchases_select_manager on public.purchases
  for select to authenticated
  using (app.has_min_role(shop_id, 'manager'));

drop policy if exists purchase_items_select_manager on public.purchase_items;
create policy purchase_items_select_manager on public.purchase_items
  for select to authenticated
  using (app.has_min_role(shop_id, 'manager'));

drop policy if exists payments_select_member on public.payments;
create policy payments_select_member on public.payments
  for select to authenticated
  using (
    -- A cashier sees the baki he collected; supplier payments are the owner's
    -- cash-flow business.
    case when party = 'supplier'
         then app.has_min_role(shop_id, 'manager')
         else app.is_shop_member(shop_id)
    end
  );

-- Expenses are the owner's private view of his own costs. A helper does not need
-- to know the rent.
drop policy if exists expenses_select_manager on public.expenses;
create policy expenses_select_manager on public.expenses
  for select to authenticated
  using (app.has_min_role(shop_id, 'manager'));

drop policy if exists expenses_update_manager on public.expenses;
create policy expenses_update_manager on public.expenses
  for update to authenticated
  using (app.has_min_role(shop_id, 'manager'))
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));

drop policy if exists expenses_delete_manager on public.expenses;
create policy expenses_delete_manager on public.expenses
  for delete to authenticated
  using (app.has_min_role(shop_id, 'manager'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Ledgers — SELECT and nothing else, for anyone
--
-- No INSERT policy: rows appear only through triggers running inside the
-- definer RPCs. No UPDATE or DELETE policy at any role, including owner. The
-- owner can void a sale, which posts a visible reversing entry; he cannot make
-- the original disappear. That asymmetry is the product.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists stock_ledger_select_manager on public.stock_ledger;
create policy stock_ledger_select_manager on public.stock_ledger
  for select to authenticated
  using (app.has_min_role(shop_id, 'manager'));

drop policy if exists party_ledger_select_member on public.party_ledger;
create policy party_ledger_select_member on public.party_ledger
  for select to authenticated
  using (
    case when party = 'supplier'
         then app.has_min_role(shop_id, 'manager')
         else app.is_shop_member(shop_id)
    end
  );

-- ───────────────────────────────────────────────────────────────────────────
-- activity_log — readable by manager and up, written by the RPCs
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists activity_log_select_manager on public.activity_log;
create policy activity_log_select_manager on public.activity_log
  for select to authenticated
  using (app.has_min_role(shop_id, 'manager'));

drop policy if exists activity_log_insert_member on public.activity_log;
create policy activity_log_insert_member on public.activity_log
  for insert to authenticated
  with check (app.is_shop_member(shop_id) and user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- Table grants
--
-- RLS narrows which ROWS a role may reach; grants decide whether it may attempt
-- the command at all. Both are needed, and the order matters here.
--
-- Supabase ships ALTER DEFAULT PRIVILEGES that grant ALL on new tables in public
-- to anon, authenticated and service_role. So every table created in the earlier
-- migrations already carries a blanket grant, and simply adding narrower grants
-- on top would change nothing. We revoke first, table by table, then grant back
-- exactly what each role needs — which makes the list below authoritative rather
-- than decorative.
--
-- Revoking per-table rather than with ALL TABLES IN SCHEMA is deliberate: the ten
-- reporting views from 000900 live in the same schema and were already granted to
-- `authenticated`, and a blanket revoke would silently break every report screen.
--
-- `anon` gets nothing at all. There is no public surface in this product; an
-- unauthenticated request should not even be able to probe whether a shop exists.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'shops', 'shop_members', 'subscriptions', 'shop_counters',
    'categories', 'products', 'customers', 'suppliers',
    'sales', 'sale_items', 'purchases', 'purchase_items',
    'payments', 'expenses', 'stock_ledger', 'party_ledger', 'activity_log'
  ]
  loop
    execute format('revoke all on public.%I from anon, authenticated', v_table);
  end loop;
end $$;

grant select, insert, update          on public.profiles       to authenticated;
grant select, update, delete          on public.shops          to authenticated;
grant select, insert, update, delete  on public.shop_members   to authenticated;
grant select                          on public.subscriptions  to authenticated;
grant select, insert, update, delete  on public.categories     to authenticated;
grant select, insert, update, delete  on public.products       to authenticated;
grant select, insert, update, delete  on public.customers      to authenticated;
grant select, insert, update, delete  on public.suppliers      to authenticated;
grant select                          on public.sales          to authenticated;
grant select                          on public.sale_items     to authenticated;
grant select                          on public.purchases      to authenticated;
grant select                          on public.purchase_items to authenticated;
grant select                          on public.payments       to authenticated;
grant select, update, delete          on public.expenses       to authenticated;
grant select                          on public.stock_ledger   to authenticated;
grant select                          on public.party_ledger   to authenticated;
grant select, insert                  on public.activity_log   to authenticated;

-- shop_counters is absent from the grant list on purpose: `authenticated` has no
-- privilege on it whatsoever. app.next_counter() is the only way in.

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime
--
-- Realtime respects RLS on the subscribing user's behalf, so publishing these
-- tables is safe. Only the ones two devices genuinely need to agree on are
-- published: the second phone behind the counter should see stock drop and a
-- baki clear. Publishing sale_items or the ledgers would multiply message
-- volume for no visible benefit on a 3G connection.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.sales;
      alter publication supabase_realtime add table public.products;
      alter publication supabase_realtime add table public.customers;
      alter publication supabase_realtime add table public.payments;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;


-- === 20260826001200_starter_catalog.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 001200 · Starter catalogue
--
-- Onboarding is where this product lives or dies. A shopkeeper who has to type
-- four hundred products before he can ring up his first sale will put the phone
-- down and go back to the khata — and he will be right to. So a new shop can be
-- seeded with the sixty-odd items that are on virtually every মুদি দোকান shelf
-- in Bangladesh, already priced, already categorised, already carrying sensible
-- reorder points.
--
-- The prices are starting points, not claims. They sit in roughly the right
-- neighbourhood for a neighbourhood shop, and the first time the owner edits one
-- he learns the catalogue is his. The Bengali name is the primary label — it is
-- what he reads on the shelf and what he wants on the receipt — and the English
-- name exists so that typing "soyabin" in the POS search still finds it.
--
-- is_weighted is set on everything sold loose from a sack or a drum. That single
-- flag is what flips the POS from a quantity stepper to a weight pad, which is
-- the difference between two taps and a fight with a number keyboard.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.seed_starter_catalog(p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     record;
  v_cat     uuid;
  v_count   integer := 0;
begin
  perform app.assert_member(p_shop_id, 'manager');
  perform app.assert_can_write(p_shop_id);

  for v_row in
    select * from (values
      -- category            english name          bengali name        unit      weighed  buy    sell   reorder
      ('Rice & Grains',      'Miniket Rice',       'মিনিকেট চাল',       'kg',     true,     72.0,  78.0,  25.0),
      ('Rice & Grains',      'Nazirshail Rice',    'নাজিরশাইল চাল',     'kg',     true,     78.0,  85.0,  25.0),
      ('Rice & Grains',      'BR-28 Rice',         'ব্রি-২৮ চাল',        'kg',     true,     55.0,  60.0,  30.0),
      ('Rice & Grains',      'Chinigura Rice',     'চিনিগুঁড়া চাল',      'kg',     true,    130.0, 145.0,   5.0),
      ('Rice & Grains',      'Puffed Rice',        'মুড়ি',              'kg',     true,     80.0,  95.0,   4.0),
      ('Rice & Grains',      'Flattened Rice',     'চিড়া',              'kg',     true,     65.0,  75.0,   4.0),

      ('Lentils',            'Masoor Dal',         'মসুর ডাল',          'kg',     true,    125.0, 135.0,   8.0),
      ('Lentils',            'Moong Dal',          'মুগ ডাল',           'kg',     true,    155.0, 170.0,   5.0),
      ('Lentils',            'Anchor Dal',         'অ্যাংকর ডাল',       'kg',     true,     70.0,  78.0,   8.0),
      ('Lentils',            'Khesari Dal',        'খেসারি ডাল',        'kg',     true,     90.0, 100.0,   5.0),
      ('Lentils',            'Chickpeas',          'ছোলা',              'kg',     true,     95.0, 105.0,   5.0),
      ('Lentils',            'Peas Dal',           'মটর ডাল',           'kg',     true,     85.0,  95.0,   4.0),

      ('Oil & Ghee',         'Soybean Oil 1L',     'সয়াবিন তেল ১ লিটার','piece',  false,   165.0, 175.0,  12.0),
      ('Oil & Ghee',         'Soybean Oil 5L',     'সয়াবিন তেল ৫ লিটার','piece',  false,   800.0, 840.0,   4.0),
      ('Oil & Ghee',         'Loose Soybean Oil',  'খোলা সয়াবিন তেল',   'litre',  true,    155.0, 165.0,  10.0),
      ('Oil & Ghee',         'Palm Oil',           'পাম তেল',           'litre',  true,    130.0, 140.0,  10.0),
      ('Oil & Ghee',         'Mustard Oil 250ml',  'সরিষার তেল ২৫০ মি.লি.','piece',false,    90.0, 100.0,   6.0),
      ('Oil & Ghee',         'Ghee 500g',          'ঘি ৫০০ গ্রাম',      'piece',  false,   650.0, 720.0,   3.0),

      ('Spices',             'Turmeric Powder',    'হলুদ গুঁড়া',        'gram',   true,      0.32,  0.38, 500.0),
      ('Spices',             'Chilli Powder',      'মরিচ গুঁড়া',        'gram',   true,      0.45,  0.55, 500.0),
      ('Spices',             'Coriander Powder',   'ধনে গুঁড়া',         'gram',   true,      0.30,  0.36, 400.0),
      ('Spices',             'Cumin',              'জিরা',              'gram',   true,      0.65,  0.75, 300.0),
      ('Spices',             'Cardamom',           'এলাচ',              'gram',   true,      4.40,  5.00,  50.0),
      ('Spices',             'Cinnamon',           'দারুচিনি',          'gram',   true,      0.55,  0.65, 100.0),
      ('Spices',             'Bay Leaf',           'তেজপাতা',           'gram',   true,      0.25,  0.35, 100.0),
      ('Spices',             'Onion',              'পেঁয়াজ',            'kg',     true,     55.0,  65.0,  10.0),
      ('Spices',             'Garlic',             'রসুন',              'kg',     true,    180.0, 200.0,   5.0),
      ('Spices',             'Ginger',             'আদা',               'kg',     true,    160.0, 180.0,   4.0),

      ('Sugar & Salt',       'Sugar',              'চিনি',              'kg',     true,    118.0, 128.0,  10.0),
      ('Sugar & Salt',       'Salt 1kg',           'লবণ ১ কেজি',        'packet', false,    38.0,  42.0,  15.0),
      ('Sugar & Salt',       'Molasses',           'গুড়',               'kg',     true,    120.0, 140.0,   3.0),

      ('Flour',              'Atta 2kg',           'আটা ২ কেজি',        'packet', false,   105.0, 115.0,  10.0),
      ('Flour',              'Loose Atta',         'খোলা আটা',          'kg',     true,     48.0,  55.0,  15.0),
      ('Flour',              'Maida',              'ময়দা',              'kg',     true,     55.0,  62.0,   8.0),
      ('Flour',              'Semolina',           'সুজি',              'kg',     true,     70.0,  80.0,   5.0),
      ('Flour',              'Besan',              'বেসন',              'kg',     true,     95.0, 110.0,   4.0),

      ('Dairy & Eggs',       'Powdered Milk 500g', 'গুঁড়া দুধ ৫০০ গ্রাম','piece', false,   420.0, 450.0,   5.0),
      ('Dairy & Eggs',       'Condensed Milk',     'কনডেন্সড মিল্ক',    'piece',  false,   110.0, 120.0,   6.0),
      ('Dairy & Eggs',       'Eggs (hali)',        'ডিম (হালি)',        'hali',   false,    42.0,  48.0,  10.0),
      ('Dairy & Eggs',       'Yoghurt 500g',       'দই ৫০০ গ্রাম',      'piece',  false,    90.0, 100.0,   4.0),
      ('Dairy & Eggs',       'Liquid Milk 500ml',  'তরল দুধ ৫০০ মি.লি.','piece',  false,    45.0,  50.0,   6.0),

      ('Biscuits & Snacks',  'Bread',              'পাউরুটি',           'piece',  false,    55.0,  60.0,   5.0),
      ('Biscuits & Snacks',  'Marie Biscuit',      'মেরি বিস্কুট',      'packet', false,    30.0,  35.0,  12.0),
      ('Biscuits & Snacks',  'Toast Biscuit',      'টোস্ট বিস্কুট',     'packet', false,    35.0,  40.0,  10.0),
      ('Biscuits & Snacks',  'Chanachur',          'চানাচুর',           'packet', false,    20.0,  25.0,  15.0),
      ('Biscuits & Snacks',  'Chips',              'চিপস',              'packet', false,    20.0,  25.0,  20.0),
      ('Biscuits & Snacks',  'Instant Noodles',    'নুডলস',             'packet', false,    18.0,  22.0,  24.0),
      ('Biscuits & Snacks',  'Lachchha Semai',     'লাচ্ছা সেমাই',      'packet', false,    45.0,  50.0,   6.0),

      ('Beverages',          'Tea Leaves 400g',    'চা পাতা ৪০০ গ্রাম', 'piece',  false,   180.0, 200.0,   5.0),
      ('Beverages',          'Instant Coffee',     'কফি',               'piece',  false,   250.0, 280.0,   3.0),
      ('Beverages',          'Cola 1L',            'কোক ১ লিটার',       'piece',  false,    90.0, 100.0,   8.0),
      ('Beverages',          'Drinking Water 1L',  'পানি ১ লিটার',      'piece',  false,    15.0,  20.0,  12.0),
      ('Beverages',          'Mango Juice',        'আমের জুস',          'piece',  false,    25.0,  30.0,  12.0),
      ('Beverages',          'Saline',             'খাবার স্যালাইন',    'packet', false,     5.0,   6.0,  30.0),

      ('Soap & Cleaning',    'Bath Soap',          'গোসলের সাবান',      'piece',  false,    45.0,  50.0,  12.0),
      ('Soap & Cleaning',    'Washing Soap',       'কাপড়ের সাবান',      'piece',  false,    28.0,  32.0,  12.0),
      ('Soap & Cleaning',    'Detergent 500g',     'ডিটারজেন্ট ৫০০ গ্রাম','packet',false,    90.0, 100.0,   8.0),
      ('Soap & Cleaning',    'Dishwash Bar',       'বাসন ধোয়ার সাবান',  'piece',  false,    22.0,  25.0,  10.0),
      ('Soap & Cleaning',    'Candle',             'মোমবাতি',           'packet', false,    35.0,  40.0,   6.0),
      ('Soap & Cleaning',    'Matchbox',           'দিয়াশলাই',          'piece',  false,     5.0,   6.0,  24.0),

      ('Personal Care',      'Shampoo Sachet',     'শ্যাম্পু (মিনি প্যাক)','piece',false,     8.0,  10.0,  40.0),
      ('Personal Care',      'Toothpaste 100g',    'টুথপেস্ট ১০০ গ্রাম','piece',  false,    95.0, 105.0,   6.0),
      ('Personal Care',      'Toothbrush',         'টুথব্রাশ',          'piece',  false,    40.0,  50.0,   8.0),
      ('Personal Care',      'Coconut Oil 100ml',  'নারিকেল তেল ১০০ মি.লি.','piece',false,   65.0,  75.0,   6.0),
      ('Personal Care',      'Body Lotion 100ml',  'লোশন ১০০ মি.লি.',   'piece',  false,   130.0, 145.0,   4.0),
      ('Personal Care',      'Sanitary Napkin',    'স্যানিটারি ন্যাপকিন','packet', false,   105.0, 120.0,   5.0),

      ('Baby Care',          'Diaper (piece)',     'ডায়াপার',           'piece',  false,    25.0,  30.0,  20.0),
      ('Baby Care',          'Baby Powder 100g',   'বেবি পাউডার',       'piece',  false,   110.0, 125.0,   3.0),

      ('Stationery',         'Exercise Book',      'খাতা',              'piece',  false,    30.0,  35.0,  10.0),
      ('Stationery',         'Ball Pen',           'কলম',               'piece',  false,     8.0,  10.0,  25.0),
      ('Stationery',         'Pencil',             'পেন্সিল',           'piece',  false,     5.0,   7.0,  25.0),

      ('Tobacco',            'Cigarette Packet',   'সিগারেট প্যাকেট',   'packet', false,   180.0, 190.0,  10.0),
      ('Tobacco',            'Biri Bundle',        'বিড়ি',              'bundle', false,    25.0,  30.0,  10.0)
    ) as t(cat, name, name_bn, unit, weighed, buy, sell, reorder)
  loop
    -- Idempotent: seeding twice must not double the catalogue. Matched on the
    -- English name because that is the stable key here; a shopkeeper who has
    -- renamed an item has made it his, and we leave it alone.
    if exists (
      select 1 from public.products p
       where p.shop_id = p_shop_id
         and lower(p.name) = lower(v_row.name)
    ) then
      continue;
    end if;

    select c.id into v_cat
      from public.categories c
     where c.shop_id = p_shop_id
       and lower(c.name) = lower(v_row.cat)
     limit 1;

    insert into public.products
      (shop_id, category_id, name, name_bn, unit, is_weighted,
       buy_price, sell_price, low_stock_threshold, is_active)
    values
      (p_shop_id, v_cat, v_row.name, v_row.name_bn,
       v_row.unit::unit_type, v_row.weighed,
       round(v_row.buy::numeric, 2), round(v_row.sell::numeric, 2),
       v_row.reorder::numeric, true);

    v_count := v_count + 1;
  end loop;

  insert into public.activity_log (shop_id, user_id, action, entity, meta)
  values (p_shop_id, auth.uid(), 'catalog.seeded', 'products',
          jsonb_build_object('count', v_count));

  return v_count;
end;
$$;

comment on function public.seed_starter_catalog(uuid) is
  'Seeds ~75 common Bangladeshi grocery items into a shop. Idempotent: skips any product whose English name already exists.';

revoke all on function public.seed_starter_catalog(uuid) from public;
grant execute on function public.seed_starter_catalog(uuid) to authenticated;


-- === seed.sql ===
-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · seed.sql — a demo shop with two weeks of trading history
--
-- Run automatically by `supabase db reset`. Two things make this worth more than
-- a handful of placeholder rows:
--
-- 1. It goes through the real RPCs rather than inserting into sales and
--    party_ledger directly. So `supabase db reset` is also a smoke test of the
--    write path: if a trigger, a generated column or an idempotency guard is
--    broken, the reset fails loudly instead of producing a database that looks
--    fine until a customer disputes a balance.
--
-- 2. Two weeks of history means every report screen has something real to draw.
--    A dashboard developed against zero rows is a dashboard designed for a state
--    no shop is ever in.
--
-- auth.uid() reads request.jwt.claims, so setting that GUC lets us call the
-- SECURITY DEFINER functions exactly as the browser would.
--
-- Sign in with:  demo@mudidokan.app  /  mudidokan
-- ═══════════════════════════════════════════════════════════════════════════

do $seed$
declare
  v_owner   uuid := '11111111-1111-4111-8111-111111111111';
  v_helper  uuid := '22222222-2222-4222-8222-222222222222';
  v_shop    uuid;
  v_result  jsonb;

  v_nasrin  uuid;
  v_karim   uuid;
  v_shefali uuid;
  v_jamal   uuid;
  v_supplier uuid;

  v_day     date;
  v_i       integer;
  v_k       integer;
  v_n       integer;
  v_items   jsonb;
  v_total   numeric;
  v_paid    numeric;
  v_cust    uuid;
  v_when    timestamptz;
  v_p       record;
  v_qty     numeric;
begin
  if exists (select 1 from public.shops) then
    raise notice 'seed: shops already present, skipping';
    return;
  end if;

  -- ── Users ────────────────────────────────────────────────────────────────
  -- The profiles rows appear on their own via trg_on_auth_user_created.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'demo@mudidokan.app',
     extensions.crypt('mudidokan', extensions.gen_salt('bf')),
     now(), now() - interval '40 days', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"রফিক উদ্দিন","phone":"01712345678"}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', v_helper, 'authenticated', 'authenticated',
     'helper@mudidokan.app',
     extensions.crypt('mudidokan', extensions.gen_salt('bf')),
     now(), now() - interval '20 days', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"সুমন","phone":"01812345678"}'::jsonb);

  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values
    (gen_random_uuid(), v_owner, v_owner::text,
     jsonb_build_object('sub', v_owner::text, 'email', 'demo@mudidokan.app',
                        'email_verified', true, 'phone_verified', false),
     'email', now(), now(), now()),
    (gen_random_uuid(), v_helper, v_helper::text,
     jsonb_build_object('sub', v_helper::text, 'email', 'helper@mudidokan.app',
                        'email_verified', true, 'phone_verified', false),
     'email', now(), now(), now());

  -- ── Act as the owner from here on ────────────────────────────────────────
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
                     false);

  v_result := public.create_shop_with_owner(jsonb_build_object(
    'name',           'Rafiq Store',
    'name_bn',        'রফিক স্টোর',
    'phone',          '01712345678',
    'address',        'বাজার রোড, সদর',
    'district',       'কুমিল্লা',
    'invoice_prefix', 'RS',
    'receipt_footer', 'ধন্যবাদ — আবার আসবেন',
    'seed_catalog',   true
  ));
  v_shop := (v_result -> 'shop' ->> 'id')::uuid;

  -- Sumon behind the counter.
  insert into public.shop_members (shop_id, user_id, role, status, invited_by)
  values (v_shop, v_helper, 'cashier', 'active', v_owner);

  -- ── Khata customers ──────────────────────────────────────────────────────
  insert into public.customers (shop_id, name, phone, address, credit_limit, note)
  values
    (v_shop, 'নাসরিন বেগম', '01911111111', 'পশ্চিম পাড়া',  3000, 'প্রতি মাসের ৫ তারিখে দেন'),
    (v_shop, 'করিম মিয়া',   '01922222222', 'স্কুল রোড',     2000, null),
    (v_shop, 'শেফালী আক্তার','01933333333', 'পুকুর পাড়',    1500, null),
    (v_shop, 'জামাল হোসেন', '01944444444', 'বাসস্ট্যান্ড',  5000, 'রিকশা গ্যারেজ');

  select id into v_nasrin  from public.customers where shop_id = v_shop and name = 'নাসরিন বেগম';
  select id into v_karim   from public.customers where shop_id = v_shop and name = 'করিম মিয়া';
  select id into v_shefali from public.customers where shop_id = v_shop and name = 'শেফালী আক্তার';
  select id into v_jamal   from public.customers where shop_id = v_shop and name = 'জামাল হোসেন';

  insert into public.suppliers (shop_id, name, company, phone, note)
  values (v_shop, 'আব্দুল মহাজন', 'রহমান ট্রেডার্স', '01755555555', 'সপ্তাহে দুইবার আসেন')
  returning id into v_supplier;

  -- Paper-khata balances carried over on day one. This is the migration path a
  -- real shopkeeper takes, and it is worth having in the demo data.
  perform public.set_opening_balance(jsonb_build_object(
    'shop_id', v_shop, 'party', 'customer', 'customer_id', v_nasrin,
    'amount', 850, 'client_uuid', gen_random_uuid(),
    'occurred_at', (now() - interval '14 days')::text));

  perform public.set_opening_balance(jsonb_build_object(
    'shop_id', v_shop, 'party', 'customer', 'customer_id', v_jamal,
    'amount', 1240, 'client_uuid', gen_random_uuid(),
    'occurred_at', (now() - interval '14 days')::text));

  -- ── Opening stock ────────────────────────────────────────────────────────
  -- Goods arrive as a purchase, not as a typed-in number, so the stock ledger
  -- has a real starting entry and the COGS figures mean something.
  select jsonb_agg(jsonb_build_object(
           'product_id', p.id,
           'qty', case when p.unit in ('kg', 'litre') then 40
                       when p.unit = 'gram' then 2000
                       else 24 end,
           'unit', p.unit::text,
           'unit_cost', p.buy_price))
    into v_items
    from public.products p
   where p.shop_id = v_shop;

  perform public.create_purchase(jsonb_build_object(
    'shop_id',      v_shop,
    'supplier_id',  v_supplier,
    'supplier_ref', 'RT-4471',
    'items',        v_items,
    'paid',         0,
    'note',         'দোকান খোলার মাল',
    'purchased_at', (now() - interval '14 days')::text,
    'client_uuid',  gen_random_uuid()));

  -- ── Fourteen days of trading ─────────────────────────────────────────────
  perform setseed(0.42);  -- deterministic, so screenshots and tests agree

  for v_i in reverse 13 .. 0 loop
    v_day := (now() - make_interval(days => v_i))::date;

    -- Six to eleven sales a day, weighted toward the evening rush.
    v_n := 6 + floor(random() * 6)::int;

    for v_k in 1 .. v_n loop
      v_when := v_day
              + make_interval(hours  => 7 + floor(random() * 14)::int,
                              mins   => floor(random() * 60)::int);

      -- Two to five lines, drawn from what actually moves in a grocery.
      v_items := '[]'::jsonb;
      for v_p in
        select p.id, p.unit, p.sell_price, p.buy_price, p.is_weighted
          from public.products p
         where p.shop_id = v_shop
         order by random()
         limit 2 + floor(random() * 4)::int
      loop
        v_qty := case
                   when v_p.unit = 'gram'            then (array[50, 100, 200, 250])[1 + floor(random() * 4)::int]
                   when v_p.unit in ('kg', 'litre')  then (array[0.5, 1, 2, 3, 5])[1 + floor(random() * 5)::int]
                   else 1 + floor(random() * 3)::int
                 end;

        v_items := v_items || jsonb_build_object(
          'product_id', v_p.id,
          'qty',        v_qty,
          'unit',       v_p.unit::text,
          'unit_price', v_p.sell_price,
          'buy_price',  v_p.buy_price);
      end loop;

      -- Roughly one sale in three goes on the khata: this market runs on credit,
      -- and a demo that hides that hides the whole point of the product.
      v_cust := case floor(random() * 9)::int
                  when 0 then v_nasrin
                  when 1 then v_karim
                  when 2 then v_shefali
                  when 3 then v_jamal
                  else null
                end;

      select coalesce(sum(round((x ->> 'qty')::numeric * (x ->> 'unit_price')::numeric, 2)), 0)
        into v_total
        from jsonb_array_elements(v_items) as x;

      -- Walk-ins pay in full. Khata customers usually pay something and carry
      -- the rest, which is exactly the pattern the dues screen has to handle.
      v_paid := case
                  when v_cust is null then v_total
                  when random() < 0.35 then v_total
                  else round((v_total * (random() * 0.6))::numeric, 2)
                end;

      perform public.create_sale(jsonb_build_object(
        'shop_id',        v_shop,
        'customer_id',    v_cust,
        'items',          v_items,
        'paid',           v_paid,
        'payment_method', case when v_cust is not null and v_paid < v_total then 'due'
                               when random() < 0.18 then 'bkash'
                               else 'cash' end,
        'sold_at',        v_when::text,
        'client_uuid',    gen_random_uuid()));
    end loop;

    -- Daily costs. Unrecorded expenses make net profit fiction, so the demo
    -- records them.
    perform public.create_expense(jsonb_build_object(
      'shop_id', v_shop, 'category', 'transport',
      'amount', 60 + floor(random() * 80),
      'note', 'ভ্যান ভাড়া',
      'spent_at', (v_day + interval '9 hours')::text,
      'client_uuid', gen_random_uuid()));

    if v_i % 7 = 3 then
      perform public.create_expense(jsonb_build_object(
        'shop_id', v_shop, 'category', 'utility',
        'amount', 480, 'note', 'বিদ্যুৎ বিল',
        'spent_at', (v_day + interval '11 hours')::text,
        'client_uuid', gen_random_uuid()));
    end if;

    -- A couple of baki collections a week.
    if v_i % 4 = 1 then
      perform public.record_payment(jsonb_build_object(
        'shop_id', v_shop, 'party', 'customer', 'direction', 'in',
        'customer_id', case when v_i % 8 = 1 then v_nasrin else v_karim end,
        'amount', 200 + floor(random() * 600),
        'method', 'cash', 'note', 'বাকি জমা',
        'paid_at', (v_day + interval '19 hours')::text,
        'client_uuid', gen_random_uuid()));
    end if;
  end loop;

  -- ── A mid-month restock, partly paid ─────────────────────────────────────
  select jsonb_agg(jsonb_build_object(
           'product_id', p.id,
           'qty', case when p.unit in ('kg', 'litre') then 25
                       when p.unit = 'gram' then 1000
                       else 12 end,
           'unit', p.unit::text,
           'unit_cost', round((p.buy_price * 1.02)::numeric, 2)))
    into v_items
    from (select * from public.products
           where shop_id = v_shop order by random() limit 20) p;

  select coalesce(sum(round((x ->> 'qty')::numeric * (x ->> 'unit_cost')::numeric, 2)), 0)
    into v_total
    from jsonb_array_elements(v_items) as x;

  perform public.create_purchase(jsonb_build_object(
    'shop_id',      v_shop,
    'supplier_id',  v_supplier,
    'supplier_ref', 'RT-4602',
    'items',        v_items,
    'paid',         round((v_total * 0.6)::numeric, 2),
    'note',         'সাপ্তাহিক মাল',
    'purchased_at', (now() - interval '5 days')::text,
    'client_uuid',  gen_random_uuid()));

  perform public.record_payment(jsonb_build_object(
    'shop_id', v_shop, 'party', 'supplier', 'direction', 'out',
    'supplier_id', v_supplier, 'amount', 4000, 'method', 'bkash',
    'note', 'মহাজনের টাকা',
    'paid_at', (now() - interval '2 days')::text,
    'client_uuid', gen_random_uuid()));

  -- ── Shrinkage and spoilage, so the stock ledger has something to explain ──
  perform public.adjust_stock(jsonb_build_object(
    'shop_id', v_shop,
    'product_id', (select id from public.products
                    where shop_id = v_shop and name = 'Sugar' limit 1),
    'delta', -1.5, 'reason', 'damage', 'note', 'বৃষ্টিতে ভিজে গেছে',
    'client_uuid', gen_random_uuid()));

  perform public.adjust_stock(jsonb_build_object(
    'shop_id', v_shop,
    'product_id', (select id from public.products
                    where shop_id = v_shop and name = 'Bread' limit 1),
    'delta', -2, 'reason', 'expiry', 'note', 'তারিখ শেষ',
    'client_uuid', gen_random_uuid()));

  -- Short-dated stock, so the expiring-soon screen is not empty.
  update public.products
     set expiry_date = current_date + 5
   where shop_id = v_shop and name in ('Yoghurt 500g', 'Liquid Milk 500ml');

  update public.products
     set expiry_date = current_date + 20
   where shop_id = v_shop and name in ('Bread', 'Marie Biscuit');

  perform set_config('request.jwt.claims', '', false);

  raise notice 'seed: shop % ready — % sales, % products',
    v_shop,
    (select count(*) from public.sales    where shop_id = v_shop),
    (select count(*) from public.products where shop_id = v_shop);
end
$seed$;

