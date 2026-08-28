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
