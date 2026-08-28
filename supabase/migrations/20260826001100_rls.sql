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
