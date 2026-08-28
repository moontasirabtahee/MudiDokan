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
