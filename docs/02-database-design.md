# MudiDokan — Database Design

Postgres 15 on Supabase. Every design decision below is recorded with its reason, because
the reasons are what let a future change be made safely.

---

## 1. The three ideas that shape the whole schema

**Tenancy is a column, not a database.** Every business table carries `shop_id`, and every
row-level security policy resolves to "is the calling user a member of this shop." One
shop's data is invisible to another's at the database layer, not the query layer, so a
forgotten `.eq('shop_id', …)` in application code is a bug rather than a breach.

**Derived numbers are never written by application code.** Stock on hand, customer
balances, and supplier balances are maintained by triggers reading append-only ledgers. If
someone inserts a sale item through the REST API, through an RPC, through the SQL editor,
or through a replayed offline outbox, the balance ends up correct. This is the single most
important structural decision in the schema and it exists because the product's core
promise is that the numbers can be trusted.

**Writes that must never be lost are idempotent.** Sales, payments, purchases, and stock
adjustments each carry a `client_uuid` generated on the device, with a unique index per
shop. The RPC that creates them checks for an existing row with that UUID and returns it
instead of inserting a second one. This is what makes offline replay safe: a device that
loses its connection mid-request can retry blindly.

---

## 2. Entity relationships

```
                            auth.users
                                │
                                ▼
                            profiles ──────────────┐
                                │                  │
                     ┌──────────┴──────────┐       │ created_by on
                     ▼                     ▼       │ every txn table
              shop_members ───────────► shops ◄────┘
                (role)                    │
                                          ├──► subscriptions      (1:1)
                                          ├──► shop_counters      (invoice numbering)
                                          ├──► categories ──► products
                                          ├──► customers
                                          ├──► suppliers
                                          │
                                          ├──► sales ──► sale_items ──► products
                                          ├──► purchases ──► purchase_items ──► products
                                          ├──► payments
                                          ├──► expenses
                                          │
                                          ├──► stock_ledger   (append-only, owns products.stock)
                                          └──► party_ledger   (append-only, owns *.due_balance)
```

The two ledger tables at the bottom are the heart of the design. Nothing writes to them
directly from the client; they are populated by triggers on the transaction tables, and
they in turn drive the cached balances.

---

## 3. Enumerated types

Enums rather than lookup tables wherever the set is genuinely closed and shop-independent.
This keeps the hot query paths join-free, which matters on a low-end device over 3G. Adding
a value later is a one-line `ALTER TYPE`.

| Type | Values | Note |
|---|---|---|
| `member_role` | `owner`, `manager`, `cashier` | Ranked; see `app.role_rank()` |
| `member_status` | `active`, `invited`, `disabled` | |
| `unit_type` | `piece`, `kg`, `gram`, `litre`, `ml`, `dozen`, `hali`, `packet`, `sack`, `bundle` | `hali` = 4, standard for eggs |
| `payment_method` | `cash`, `bkash`, `nagad`, `rocket`, `card`, `due`, `mixed` | Mobile-money first, matching real usage |
| `txn_status` | `completed`, `void` | Voids reverse via ledger, never delete |
| `party_type` | `customer`, `supplier` | |
| `ledger_entry_type` | `credit_sale`, `payment_received`, `credit_purchase`, `payment_made`, `opening_balance`, `adjustment`, `write_off`, `sale_void`, `purchase_void` | |
| `stock_reason` | `sale`, `purchase`, `sale_void`, `purchase_void`, `damage`, `expiry`, `theft`, `correction`, `return_out`, `opening` | Distinguishing damage from theft from correction is what makes shrinkage auditable |
| `expense_category` | `rent`, `utility`, `salary`, `transport`, `refreshment`, `repair`, `license`, `other` | |
| `plan_tier` | `trial`, `free`, `basic`, `pro` | |
| `sub_status` | `trialing`, `active`, `past_due`, `canceled` | |

---

## 4. Tables

### 4.1 Identity and tenancy

**`profiles`** — one row per authenticated user, keyed on `auth.users.id`, created
automatically by a trigger on user signup so the application never has to handle a
missing profile. Holds `full_name`, `phone`, and `preferred_locale` (`bn` default). Phone
is stored here rather than used for auth because real phone-OTP requires a paid SMS
provider; when one is contracted, this column is already the identity anchor.

**`shops`** — the tenant. Name in Bengali and English, phone, address, `district`,
`currency` (default `BDT`), `timezone` (default `Asia/Dhaka`), `low_stock_default`,
`invoice_prefix`, and `receipt_footer`. `owner_id` denormalises the founding owner for
convenience but authority always comes from `shop_members`, so transferring ownership does
not require rewriting rows.

**`shop_members`** — the authorisation table: `(shop_id, user_id, role, status)` with a
unique constraint on the pair. `user_id` is nullable while `status = 'invited'`, because an
invite is created before the invitee has an account; `invited_email` carries the address
until `accept_invite()` binds it. A partial unique index on `(shop_id, lower(invited_email))
where status = 'invited'` prevents duplicate pending invites.

**`subscriptions`** — one row per shop, created with `plan = 'trial'` and
`trial_ends_at = now() + 30 days` by the shop-creation RPC. `app.shop_can_write()` reads
this, and write policies on the transaction tables consult it, so an expired shop becomes
read-only at the database layer. Read access to history is never revoked.

**`shop_counters`** — `(shop_id, kind, value)` for per-shop invoice numbering. A Postgres
sequence cannot be per-tenant, and `max(invoice_no) + 1` races under concurrency, so
numbering uses `UPDATE … SET value = value + 1 RETURNING value`, which takes a row lock and
is safe. Two cashiers ringing up simultaneously cannot collide.

### 4.2 Catalogue

**`categories`** — `(shop_id, name, name_bn, icon, sort_order)`. Per-shop rather than
global, because a shop that also sells SIM top-ups and phone cases needs categories no
global taxonomy would predict.

**`products`** — the central catalogue row. Bengali and English names both indexed for
search. `unit` from `unit_type`. `buy_price` and `sell_price` as `numeric(12,2)`.
`stock` and `low_stock_threshold` as `numeric(12,3)` — three decimals because loose goods
sell in 250 g increments and two decimals silently loses grams. `is_weighted` flips the
POS to the weight pad. `expiry_date` is nullable and drives the expiry watch. A partial
unique index on `(shop_id, barcode) where barcode is not null` allows many products
without barcodes but stops duplicates among those that have one.

`stock` is a **cache**. It is only ever written by the `stock_ledger` trigger. A
`recalc_product_stock()` function can rebuild it from the ledger, which means a bug in the
trigger is recoverable rather than corrupting.

Money uses `numeric`, never `float`. Binary floating point cannot represent BDT 0.05 and a
grocery ledger that fails to balance by one poisha destroys the trust the product depends on.

### 4.3 Parties

**`customers`** — `(shop_id, name, phone, address, credit_limit, due_balance, note)`.
`due_balance` is positive when the customer owes the shop. It is a trigger-maintained cache
over `party_ledger`, rebuildable by `recalc_customer_balance()`. `credit_limit` of 0 means
no limit; the POS warns rather than blocks, because refusing a twenty-year neighbour over a
software rule is not a decision software should make.

**`suppliers`** — mirror image: `due_balance` positive when the shop owes the supplier.

### 4.4 Transactions

**`sales`** — header row. `invoice_no bigint` from `shop_counters`. `customer_id` nullable,
since most sales are walk-ins. `subtotal`, `discount`, `total`, `paid`, and `due` — where
`due` is a **stored generated column**, `total - paid`, so it can never disagree with its
inputs. `payment_method`, `status`, `note`, `sold_at`, `created_by`, and `client_uuid` with
a unique index per shop.

**`sale_items`** — `(sale_id, shop_id, product_id, product_name_snapshot, qty, unit,
unit_price, buy_price_snapshot, line_discount, line_total generated)`.

Two snapshot columns matter. `product_name_snapshot` means a renamed or deleted product does
not rewrite history on old receipts. `buy_price_snapshot` captures cost at the moment of
sale, which is what makes gross profit *computable rather than estimated* — the
single most valuable reporting column in the schema. Without it, recalculating last
month's margin after a cost change silently produces a wrong answer.

`shop_id` is denormalised onto the child table so RLS evaluates without joining to the
parent, which is a meaningful cost saving on a table that grows fastest.

**`purchases`** / **`purchase_items`** — same shape for goods coming in. `unit_cost` on the
item; a trigger copies the latest cost up to `products.buy_price`, because "what did I pay
last time" is a question shopkeepers ask before every negotiation with a distributor.

**`payments`** — one table for money moving in either direction against either party type.
A `CHECK` constraint enforces that `party_type = 'customer'` implies `customer_id` is set
and `supplier_id` is null, and vice versa, so the polymorphic reference cannot be
half-populated. `direction` (`in`/`out`) is separate from `party_type` because a refund to a
customer is money out to a customer.

**`expenses`** — `(shop_id, category, amount, note, spent_at, created_by)`. Deliberately the
simplest table in the schema; friction here means it does not get used, and unrecorded
expenses make net profit fiction.

### 4.5 The ledgers

**`stock_ledger`** — append-only. `(shop_id, product_id, delta numeric(12,3), reason,
ref_table, ref_id, balance_after, note, created_by, created_at)`. Every movement of
physical goods lands here: a sale writes a negative delta, a purchase positive, a damage
write-off negative with `reason = 'damage'`. `balance_after` is stamped by the trigger so
the ledger reads as a bank statement without a window function on a phone.

This answers "where did 8 kg of sugar go?" with a timestamp and a staff name — which is
precisely pain point P2. It also makes voids trivial: reversal is a compensating row, so
there is never a destructive edit and the audit trail is intact.

**`party_ledger`** — append-only, the digital khata itself. `(shop_id, party_type,
customer_id, supplier_id, entry_type, amount signed, ref_table, ref_id, balance_after,
note, occurred_at, created_by)`. Positive `amount` increases what the party owes.
A credit sale posts the unpaid remainder; a collection posts a negative; an opening balance
migrates the paper book; a write-off is explicit and visible rather than a quiet edit.

Rendering a customer statement is one indexed, ordered read — no aggregation on the client,
which matters both for speed and for making the screen work from cache when offline.

**`activity_log`** — `(shop_id, user_id, action, entity, entity_id, meta jsonb)`. Insert-only,
readable by owners and managers. Staff turnover is high; when stock disagrees with the
count, someone will ask who did what.

---

## 5. Triggers — who owns which number

This table is the contract. Nothing outside it may write these columns.

| Trigger | Fires on | Effect |
|---|---|---|
| `trg_profiles_on_signup` | `auth.users` insert | Creates the `profiles` row |
| `trg_touch_updated_at` | update, several tables | Maintains `updated_at` |
| `trg_sale_items_stock` | `sale_items` insert / delete | Writes negative / compensating `stock_ledger` rows |
| `trg_purchase_items_stock` | `purchase_items` insert / delete | Writes positive `stock_ledger` rows, updates `products.buy_price` |
| `trg_stock_ledger_apply` | `stock_ledger` insert | Stamps `balance_after`, updates `products.stock` |
| `trg_sales_party_ledger` | `sales` insert / update of `paid`,`total`,`status` | Posts or corrects the `credit_sale` entry |
| `trg_purchases_party_ledger` | `purchases` insert / update | Posts the `credit_purchase` entry |
| `trg_payments_party_ledger` | `payments` insert / delete | Posts `payment_received` / `payment_made` |
| `trg_party_ledger_apply` | `party_ledger` insert | Stamps `balance_after`, updates the cached `due_balance` |
| `trg_sale_item_snapshots` | `sale_items` before insert | Fills `buy_price_snapshot` and `product_name_snapshot` from the product if not supplied |
| `trg_sales_void` | `sales` update to `status = 'void'` | Writes reversing stock and ledger rows |

Ledger inserts are guarded so a trigger-written row cannot be created twice for the same
`(ref_table, ref_id, reason)`, which keeps replay safe end to end.

---

## 6. Views

All views are declared `WITH (security_invoker = on)` so the caller's RLS applies to the
base tables. A view created without it runs as its owner and would leak every shop's data
to every user — this is the most dangerous single mistake available in a Supabase schema.

`v_products_status` adds a computed `stock_state` (`out` / `low` / `ok`) and
`days_to_expiry`, plus margin and margin percent. `v_low_stock` filters it.

`v_customer_dues` joins the cached balance to the last ledger entry to produce
`days_since_last_payment` and an `age_bucket` (`current`, `d7`, `d15`, `d30`, `d60plus`) —
the ageing view paper khatas cannot produce.

`v_supplier_dues` is the mirror.

`v_sales_daily` aggregates per shop per local day: sale count, gross, discount, net, cost of
goods sold from `buy_price_snapshot`, gross profit, cash collected, and credit given. Day
boundaries are computed in the shop's timezone, not UTC — a sale at 11:30 p.m. Dhaka
belongs to that day's takings, and UTC bucketing would file it under tomorrow and make
every daily closing wrong by one evening.

`v_product_performance` gives quantity sold, revenue, COGS, profit, and margin percent per
product, which drives the "revenue versus margin" comparison in reports.

`v_dashboard_today` returns a single row per shop with everything the home screen needs, so
the most-loaded screen in the product is one round trip.

---

## 7. RPCs

All are `SECURITY DEFINER` with `SET search_path = public, pg_temp` and an explicit
membership and role check as the first statement. `SECURITY DEFINER` bypasses RLS by
design, so an unchecked one is a hole; the check is not optional.

| Function | Purpose |
|---|---|
| `create_shop_with_owner(...)` | Atomically creates the shop, the owner membership, the trial subscription, default categories, and optionally the starter catalogue. Without this a signup that fails halfway leaves an orphan shop. |
| `create_sale(payload jsonb)` | Idempotent on `client_uuid`. Allocates the invoice number, inserts header and items, lets triggers move stock and dues. Returns the sale with items. |
| `create_purchase(payload jsonb)` | Same shape for goods in. |
| `record_payment(payload jsonb)` | Idempotent collection or disbursement against a party. |
| `adjust_stock(payload jsonb)` | Manual correction with a mandatory reason. |
| `void_sale(sale_id, reason)` | Owner only. Flips status; triggers reverse everything. |
| `set_opening_balance(...)` | Migrates a paper khata page as an `opening_balance` ledger entry. |
| `invite_member(email, role)` / `accept_invite(token)` / `set_member_status(...)` | Staff lifecycle. |
| `recalc_product_stock(...)` / `recalc_customer_balance(...)` / `recalc_supplier_balance(...)` | Rebuild caches from the ledgers. Operational safety net. |
| `daily_closing(shop_id, day, counted_cash)` | Returns expected versus counted with the variance named. |

`create_sale` takes a single `jsonb` argument rather than fifteen typed parameters because
the offline outbox stores payloads as JSON. One argument means the queued payload is the
call, with no marshalling layer to drift out of sync.

---

## 8. Row-level security

RLS is enabled on every table, including the ledgers and `profiles`. There is no
`USING (true)` policy anywhere.

### Helper functions

They live in a private `app` schema so PostgREST does not expose them, and they are
`SECURITY DEFINER STABLE` with a pinned `search_path`.

```sql
app.is_shop_member(p_shop uuid)        -- membership, any active role
app.role_rank(r member_role)           -- owner 3, manager 2, cashier 1
app.has_min_role(p_shop uuid, m member_role)
app.shop_can_write(p_shop uuid)        -- subscription not expired
app.current_shop_ids()                 -- setof uuid, for IN (…) policies
```

**Why `SECURITY DEFINER` is load-bearing.** The policy on `shop_members` needs to ask "is
this user a member of this shop," which requires reading `shop_members`. Under a normal
function that read is itself subject to RLS, and Postgres raises
`infinite recursion detected in policy`. A `SECURITY DEFINER` function runs as its owner and
bypasses RLS on the tables it reads, which breaks the cycle. This is the standard fix and it
is the reason these helpers exist at all. `STABLE` lets the planner call them once per
statement instead of once per row.

### Permission matrix

| Area | cashier | manager | owner |
|---|---|---|---|
| Products, categories — read | ✅ | ✅ | ✅ |
| Products, categories — write | ❌ | ✅ | ✅ |
| Customers — read / create | ✅ | ✅ | ✅ |
| Customers — update / deactivate | ❌ | ✅ | ✅ |
| Sales — create | ✅ | ✅ | ✅ |
| Sales — void | ❌ | ❌ | ✅ |
| Payments in (collect a due) | ✅ | ✅ | ✅ |
| Payments out (pay a supplier) | ❌ | ✅ | ✅ |
| Purchases, suppliers | ❌ | ✅ | ✅ |
| Stock adjustments | ❌ | ✅ | ✅ |
| Expenses | ❌ | ✅ | ✅ |
| Reports and ledgers | own sales only | ✅ | ✅ |
| Staff management | ❌ | ❌ | ✅ |
| Shop settings, subscription | ❌ | ❌ | ✅ |

Policy shape for a typical shop-scoped table:

```sql
create policy products_select on products for select to authenticated
  using (app.is_shop_member(shop_id));

create policy products_write on products for all to authenticated
  using      (app.has_min_role(shop_id, 'manager'))
  with check (app.has_min_role(shop_id, 'manager') and app.shop_can_write(shop_id));
```

`USING` governs which existing rows are visible to the operation; `WITH CHECK` governs what
the resulting row may look like. Both are required on writes — a policy with only `USING`
lets a user update a row they can see into a shop they cannot.

Ledger tables get `select` and `insert` only. No `update`, no `delete`, for anyone. That
constraint is what makes them evidence.

### Known gap, recorded honestly

RLS filters rows, not columns. A cashier who can read `products` can read `buy_price` via
the REST API even though the UI never shows it. The correct fix is a `v_products_sellable`
view with column privileges revoked on the base table, and it is scheduled for Release 2.
It is written down here rather than left implicit because a shop owner discovering that his
helper can see cost prices is a product-ending event.

---

## 9. Indexing

Beyond primary keys and the foreign keys Postgres does not index automatically:

`(shop_id, is_active, name)` on products for the catalogue list; a trigram index on
`name` and `name_bn` for search-as-you-type, since a shopkeeper types "চাল" or "chal" and
`LIKE '%…%'` without trigram cannot use an index; `(shop_id, barcode)` partial unique.

`(shop_id, sold_at desc)` on sales for history and daily rollups; unique
`(shop_id, client_uuid)` for idempotency; `(sale_id)` on sale_items;
`(shop_id, product_id)` on sale_items for per-product reporting.

`(shop_id, product_id, created_at desc)` on stock_ledger.
`(shop_id, customer_id, occurred_at desc)` and `(shop_id, supplier_id, occurred_at desc)`
on party_ledger — these two carry the khata statement.

`(shop_id, due_balance desc)` partial on customers `where due_balance > 0`, which is the
dues list, and it stays small even when the customer table does not.

---

## 10. Migration files

Ordered, each independently reviewable, applied by `supabase db push` or in the SQL editor.

```
20260826000100_extensions.sql          pgcrypto, pg_trgm, private `app` schema
20260826000200_enums.sql               all enumerated types
20260826000300_tenancy.sql             profiles, shops, shop_members, subscriptions,
                                       counters, and the app.* RLS helpers
20260826000400_catalog.sql             categories, products
20260826000500_parties.sql             customers, suppliers
20260826000600_transactions.sql        sales, sale_items, purchases, purchase_items,
                                       payments, expenses
20260826000700_ledgers.sql             stock_ledger, party_ledger, activity_log
20260826000800_triggers.sql            every trigger from section 5, plus the
                                       derived-column guard
20260826000900_views.sql               every view from section 6, security_invoker on
20260826001000_rpc.sql                 every function from section 7
20260826001100_rls.sql                 enable RLS, all policies, revoke-then-grant
20260826001200_starter_catalog.sql     ~75 common Bangladeshi grocery items, seedable
```

The `app.*` helpers live at the end of `000300`, immediately after `shop_members` exists.
That placement is forced rather than chosen: their bodies are `language sql`, which Postgres
name-resolves and validates at creation time, so the table has to be there first. Everything
downstream — the policies in `001100`, the assertions in `001000` — depends on them, and
nothing they depend on comes later, so the ordering has no cycle to break.

`supabase/seed.sql` runs after the last migration on `supabase db reset`. It builds a demo
shop through the real RPCs rather than by inserting into `sales` and `party_ledger` directly,
which makes every reset a smoke test of the write path: a broken trigger, generated column or
idempotency guard fails the reset instead of yielding a database that looks fine until a
customer disputes a balance.
