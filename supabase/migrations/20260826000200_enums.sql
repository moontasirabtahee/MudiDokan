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
