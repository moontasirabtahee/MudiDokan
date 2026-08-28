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
