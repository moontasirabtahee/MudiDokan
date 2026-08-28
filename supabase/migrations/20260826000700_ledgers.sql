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
