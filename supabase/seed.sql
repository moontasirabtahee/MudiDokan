-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · seed.sql — a demo shop with two weeks of trading history
--
-- Run automatically by `supabase db reset`. Two things make this worth more than
-- a handful of placeholder rows:
--
-- 1. It goes through the real RPCs rather than inserting into sales and
--    party_ledger directly. So `supabase db reset` is also a smoke test of the
--    write path: if a trigger, a generated column or an idempotency guard is
--    broken, the reset fails loudly instead of producing a database that looks
--    fine until a customer disputes a balance.
--
-- 2. Two weeks of history means every report screen has something real to draw.
--    A dashboard developed against zero rows is a dashboard designed for a state
--    no shop is ever in.
--
-- auth.uid() reads request.jwt.claims, so setting that GUC lets us call the
-- SECURITY DEFINER functions exactly as the browser would.
--
-- Sign in with:  demo@mudidokan.app  /  mudidokan
-- ═══════════════════════════════════════════════════════════════════════════

do $seed$
declare
  v_owner   uuid := '11111111-1111-4111-8111-111111111111';
  v_helper  uuid := '22222222-2222-4222-8222-222222222222';
  v_shop    uuid;
  v_result  jsonb;

  v_nasrin  uuid;
  v_karim   uuid;
  v_shefali uuid;
  v_jamal   uuid;
  v_supplier uuid;

  v_day     date;
  v_i       integer;
  v_k       integer;
  v_n       integer;
  v_items   jsonb;
  v_total   numeric;
  v_paid    numeric;
  v_cust    uuid;
  v_when    timestamptz;
  v_p       record;
  v_qty     numeric;
begin
  if exists (select 1 from public.shops) then
    raise notice 'seed: shops already present, skipping';
    return;
  end if;

  -- ── Users ────────────────────────────────────────────────────────────────
  -- The profiles rows appear on their own via trg_on_auth_user_created.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'demo@mudidokan.app',
     extensions.crypt('mudidokan', extensions.gen_salt('bf')),
     now(), now() - interval '40 days', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"রফিক উদ্দিন","phone":"01712345678"}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', v_helper, 'authenticated', 'authenticated',
     'helper@mudidokan.app',
     extensions.crypt('mudidokan', extensions.gen_salt('bf')),
     now(), now() - interval '20 days', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"সুমন","phone":"01812345678"}'::jsonb);

  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values
    (gen_random_uuid(), v_owner, v_owner::text,
     jsonb_build_object('sub', v_owner::text, 'email', 'demo@mudidokan.app',
                        'email_verified', true, 'phone_verified', false),
     'email', now(), now(), now()),
    (gen_random_uuid(), v_helper, v_helper::text,
     jsonb_build_object('sub', v_helper::text, 'email', 'helper@mudidokan.app',
                        'email_verified', true, 'phone_verified', false),
     'email', now(), now(), now());

  -- ── Act as the owner from here on ────────────────────────────────────────
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
                     false);

  v_result := public.create_shop_with_owner(jsonb_build_object(
    'name',           'Rafiq Store',
    'name_bn',        'রফিক স্টোর',
    'phone',          '01712345678',
    'address',        'বাজার রোড, সদর',
    'district',       'কুমিল্লা',
    'invoice_prefix', 'RS',
    'receipt_footer', 'ধন্যবাদ — আবার আসবেন',
    'seed_catalog',   true
  ));
  v_shop := (v_result -> 'shop' ->> 'id')::uuid;

  -- Sumon behind the counter.
  insert into public.shop_members (shop_id, user_id, role, status, invited_by)
  values (v_shop, v_helper, 'cashier', 'active', v_owner);

  -- ── Khata customers ──────────────────────────────────────────────────────
  insert into public.customers (shop_id, name, phone, address, credit_limit, note)
  values
    (v_shop, 'নাসরিন বেগম', '01911111111', 'পশ্চিম পাড়া',  3000, 'প্রতি মাসের ৫ তারিখে দেন'),
    (v_shop, 'করিম মিয়া',   '01922222222', 'স্কুল রোড',     2000, null),
    (v_shop, 'শেফালী আক্তার','01933333333', 'পুকুর পাড়',    1500, null),
    (v_shop, 'জামাল হোসেন', '01944444444', 'বাসস্ট্যান্ড',  5000, 'রিকশা গ্যারেজ');

  select id into v_nasrin  from public.customers where shop_id = v_shop and name = 'নাসরিন বেগম';
  select id into v_karim   from public.customers where shop_id = v_shop and name = 'করিম মিয়া';
  select id into v_shefali from public.customers where shop_id = v_shop and name = 'শেফালী আক্তার';
  select id into v_jamal   from public.customers where shop_id = v_shop and name = 'জামাল হোসেন';

  insert into public.suppliers (shop_id, name, company, phone, note)
  values (v_shop, 'আব্দুল মহাজন', 'রহমান ট্রেডার্স', '01755555555', 'সপ্তাহে দুইবার আসেন')
  returning id into v_supplier;

  -- Paper-khata balances carried over on day one. This is the migration path a
  -- real shopkeeper takes, and it is worth having in the demo data.
  perform public.set_opening_balance(jsonb_build_object(
    'shop_id', v_shop, 'party', 'customer', 'customer_id', v_nasrin,
    'amount', 850, 'client_uuid', gen_random_uuid(),
    'occurred_at', (now() - interval '14 days')::text));

  perform public.set_opening_balance(jsonb_build_object(
    'shop_id', v_shop, 'party', 'customer', 'customer_id', v_jamal,
    'amount', 1240, 'client_uuid', gen_random_uuid(),
    'occurred_at', (now() - interval '14 days')::text));

  -- ── Opening stock ────────────────────────────────────────────────────────
  -- Goods arrive as a purchase, not as a typed-in number, so the stock ledger
  -- has a real starting entry and the COGS figures mean something.
  select jsonb_agg(jsonb_build_object(
           'product_id', p.id,
           'qty', case when p.unit in ('kg', 'litre') then 40
                       when p.unit = 'gram' then 2000
                       else 24 end,
           'unit', p.unit::text,
           'unit_cost', p.buy_price))
    into v_items
    from public.products p
   where p.shop_id = v_shop;

  perform public.create_purchase(jsonb_build_object(
    'shop_id',      v_shop,
    'supplier_id',  v_supplier,
    'supplier_ref', 'RT-4471',
    'items',        v_items,
    'paid',         0,
    'note',         'দোকান খোলার মাল',
    'purchased_at', (now() - interval '14 days')::text,
    'client_uuid',  gen_random_uuid()));

  -- ── Fourteen days of trading ─────────────────────────────────────────────
  perform setseed(0.42);  -- deterministic, so screenshots and tests agree

  for v_i in reverse 13 .. 0 loop
    v_day := (now() - make_interval(days => v_i))::date;

    -- Six to eleven sales a day, weighted toward the evening rush.
    v_n := 6 + floor(random() * 6)::int;

    for v_k in 1 .. v_n loop
      v_when := v_day
              + make_interval(hours  => 7 + floor(random() * 14)::int,
                              mins   => floor(random() * 60)::int);

      -- Two to five lines, drawn from what actually moves in a grocery.
      v_items := '[]'::jsonb;
      for v_p in
        select p.id, p.unit, p.sell_price, p.buy_price, p.is_weighted
          from public.products p
         where p.shop_id = v_shop
         order by random()
         limit 2 + floor(random() * 4)::int
      loop
        v_qty := case
                   when v_p.unit = 'gram'            then (array[50, 100, 200, 250])[1 + floor(random() * 4)::int]
                   when v_p.unit in ('kg', 'litre')  then (array[0.5, 1, 2, 3, 5])[1 + floor(random() * 5)::int]
                   else 1 + floor(random() * 3)::int
                 end;

        v_items := v_items || jsonb_build_object(
          'product_id', v_p.id,
          'qty',        v_qty,
          'unit',       v_p.unit::text,
          'unit_price', v_p.sell_price,
          'buy_price',  v_p.buy_price);
      end loop;

      -- Roughly one sale in three goes on the khata: this market runs on credit,
      -- and a demo that hides that hides the whole point of the product.
      v_cust := case floor(random() * 9)::int
                  when 0 then v_nasrin
                  when 1 then v_karim
                  when 2 then v_shefali
                  when 3 then v_jamal
                  else null
                end;

      select coalesce(sum(round((x ->> 'qty')::numeric * (x ->> 'unit_price')::numeric, 2)), 0)
        into v_total
        from jsonb_array_elements(v_items) as x;

      -- Walk-ins pay in full. Khata customers usually pay something and carry
      -- the rest, which is exactly the pattern the dues screen has to handle.
      v_paid := case
                  when v_cust is null then v_total
                  when random() < 0.35 then v_total
                  else round((v_total * (random() * 0.6))::numeric, 2)
                end;

      perform public.create_sale(jsonb_build_object(
        'shop_id',        v_shop,
        'customer_id',    v_cust,
        'items',          v_items,
        'paid',           v_paid,
        'payment_method', case when v_cust is not null and v_paid < v_total then 'due'
                               when random() < 0.18 then 'bkash'
                               else 'cash' end,
        'sold_at',        v_when::text,
        'client_uuid',    gen_random_uuid()));
    end loop;

    -- Daily costs. Unrecorded expenses make net profit fiction, so the demo
    -- records them.
    perform public.create_expense(jsonb_build_object(
      'shop_id', v_shop, 'category', 'transport',
      'amount', 60 + floor(random() * 80),
      'note', 'ভ্যান ভাড়া',
      'spent_at', (v_day + interval '9 hours')::text,
      'client_uuid', gen_random_uuid()));

    if v_i % 7 = 3 then
      perform public.create_expense(jsonb_build_object(
        'shop_id', v_shop, 'category', 'utility',
        'amount', 480, 'note', 'বিদ্যুৎ বিল',
        'spent_at', (v_day + interval '11 hours')::text,
        'client_uuid', gen_random_uuid()));
    end if;

    -- A couple of baki collections a week.
    if v_i % 4 = 1 then
      perform public.record_payment(jsonb_build_object(
        'shop_id', v_shop, 'party', 'customer', 'direction', 'in',
        'customer_id', case when v_i % 8 = 1 then v_nasrin else v_karim end,
        'amount', 200 + floor(random() * 600),
        'method', 'cash', 'note', 'বাকি জমা',
        'paid_at', (v_day + interval '19 hours')::text,
        'client_uuid', gen_random_uuid()));
    end if;
  end loop;

  -- ── A mid-month restock, partly paid ─────────────────────────────────────
  select jsonb_agg(jsonb_build_object(
           'product_id', p.id,
           'qty', case when p.unit in ('kg', 'litre') then 25
                       when p.unit = 'gram' then 1000
                       else 12 end,
           'unit', p.unit::text,
           'unit_cost', round((p.buy_price * 1.02)::numeric, 2)))
    into v_items
    from (select * from public.products
           where shop_id = v_shop order by random() limit 20) p;

  select coalesce(sum(round((x ->> 'qty')::numeric * (x ->> 'unit_cost')::numeric, 2)), 0)
    into v_total
    from jsonb_array_elements(v_items) as x;

  perform public.create_purchase(jsonb_build_object(
    'shop_id',      v_shop,
    'supplier_id',  v_supplier,
    'supplier_ref', 'RT-4602',
    'items',        v_items,
    'paid',         round((v_total * 0.6)::numeric, 2),
    'note',         'সাপ্তাহিক মাল',
    'purchased_at', (now() - interval '5 days')::text,
    'client_uuid',  gen_random_uuid()));

  perform public.record_payment(jsonb_build_object(
    'shop_id', v_shop, 'party', 'supplier', 'direction', 'out',
    'supplier_id', v_supplier, 'amount', 4000, 'method', 'bkash',
    'note', 'মহাজনের টাকা',
    'paid_at', (now() - interval '2 days')::text,
    'client_uuid', gen_random_uuid()));

  -- ── Shrinkage and spoilage, so the stock ledger has something to explain ──
  perform public.adjust_stock(jsonb_build_object(
    'shop_id', v_shop,
    'product_id', (select id from public.products
                    where shop_id = v_shop and name = 'Sugar' limit 1),
    'delta', -1.5, 'reason', 'damage', 'note', 'বৃষ্টিতে ভিজে গেছে',
    'client_uuid', gen_random_uuid()));

  perform public.adjust_stock(jsonb_build_object(
    'shop_id', v_shop,
    'product_id', (select id from public.products
                    where shop_id = v_shop and name = 'Bread' limit 1),
    'delta', -2, 'reason', 'expiry', 'note', 'তারিখ শেষ',
    'client_uuid', gen_random_uuid()));

  -- Short-dated stock, so the expiring-soon screen is not empty.
  update public.products
     set expiry_date = current_date + 5
   where shop_id = v_shop and name in ('Yoghurt 500g', 'Liquid Milk 500ml');

  update public.products
     set expiry_date = current_date + 20
   where shop_id = v_shop and name in ('Bread', 'Marie Biscuit');

  perform set_config('request.jwt.claims', '', false);

  raise notice 'seed: shop % ready — % sales, % products',
    v_shop,
    (select count(*) from public.sales    where shop_id = v_shop),
    (select count(*) from public.products where shop_id = v_shop);
end
$seed$;
