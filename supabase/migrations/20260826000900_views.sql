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
