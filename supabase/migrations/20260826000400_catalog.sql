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
