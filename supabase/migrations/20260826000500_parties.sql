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
