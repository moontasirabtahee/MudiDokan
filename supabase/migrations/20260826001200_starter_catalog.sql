-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 001200 · Starter catalogue
--
-- Onboarding is where this product lives or dies. A shopkeeper who has to type
-- four hundred products before he can ring up his first sale will put the phone
-- down and go back to the khata — and he will be right to. So a new shop can be
-- seeded with the sixty-odd items that are on virtually every মুদি দোকান shelf
-- in Bangladesh, already priced, already categorised, already carrying sensible
-- reorder points.
--
-- The prices are starting points, not claims. They sit in roughly the right
-- neighbourhood for a neighbourhood shop, and the first time the owner edits one
-- he learns the catalogue is his. The Bengali name is the primary label — it is
-- what he reads on the shelf and what he wants on the receipt — and the English
-- name exists so that typing "soyabin" in the POS search still finds it.
--
-- is_weighted is set on everything sold loose from a sack or a drum. That single
-- flag is what flips the POS from a quantity stepper to a weight pad, which is
-- the difference between two taps and a fight with a number keyboard.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.seed_starter_catalog(p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     record;
  v_cat     uuid;
  v_count   integer := 0;
begin
  perform app.assert_member(p_shop_id, 'manager');
  perform app.assert_can_write(p_shop_id);

  for v_row in
    select * from (values
      -- category            english name          bengali name        unit      weighed  buy    sell   reorder
      ('Rice & Grains',      'Miniket Rice',       'মিনিকেট চাল',       'kg',     true,     72.0,  78.0,  25.0),
      ('Rice & Grains',      'Nazirshail Rice',    'নাজিরশাইল চাল',     'kg',     true,     78.0,  85.0,  25.0),
      ('Rice & Grains',      'BR-28 Rice',         'ব্রি-২৮ চাল',        'kg',     true,     55.0,  60.0,  30.0),
      ('Rice & Grains',      'Chinigura Rice',     'চিনিগুঁড়া চাল',      'kg',     true,    130.0, 145.0,   5.0),
      ('Rice & Grains',      'Puffed Rice',        'মুড়ি',              'kg',     true,     80.0,  95.0,   4.0),
      ('Rice & Grains',      'Flattened Rice',     'চিড়া',              'kg',     true,     65.0,  75.0,   4.0),

      ('Lentils',            'Masoor Dal',         'মসুর ডাল',          'kg',     true,    125.0, 135.0,   8.0),
      ('Lentils',            'Moong Dal',          'মুগ ডাল',           'kg',     true,    155.0, 170.0,   5.0),
      ('Lentils',            'Anchor Dal',         'অ্যাংকর ডাল',       'kg',     true,     70.0,  78.0,   8.0),
      ('Lentils',            'Khesari Dal',        'খেসারি ডাল',        'kg',     true,     90.0, 100.0,   5.0),
      ('Lentils',            'Chickpeas',          'ছোলা',              'kg',     true,     95.0, 105.0,   5.0),
      ('Lentils',            'Peas Dal',           'মটর ডাল',           'kg',     true,     85.0,  95.0,   4.0),

      ('Oil & Ghee',         'Soybean Oil 1L',     'সয়াবিন তেল ১ লিটার','piece',  false,   165.0, 175.0,  12.0),
      ('Oil & Ghee',         'Soybean Oil 5L',     'সয়াবিন তেল ৫ লিটার','piece',  false,   800.0, 840.0,   4.0),
      ('Oil & Ghee',         'Loose Soybean Oil',  'খোলা সয়াবিন তেল',   'litre',  true,    155.0, 165.0,  10.0),
      ('Oil & Ghee',         'Palm Oil',           'পাম তেল',           'litre',  true,    130.0, 140.0,  10.0),
      ('Oil & Ghee',         'Mustard Oil 250ml',  'সরিষার তেল ২৫০ মি.লি.','piece',false,    90.0, 100.0,   6.0),
      ('Oil & Ghee',         'Ghee 500g',          'ঘি ৫০০ গ্রাম',      'piece',  false,   650.0, 720.0,   3.0),

      ('Spices',             'Turmeric Powder',    'হলুদ গুঁড়া',        'gram',   true,      0.32,  0.38, 500.0),
      ('Spices',             'Chilli Powder',      'মরিচ গুঁড়া',        'gram',   true,      0.45,  0.55, 500.0),
      ('Spices',             'Coriander Powder',   'ধনে গুঁড়া',         'gram',   true,      0.30,  0.36, 400.0),
      ('Spices',             'Cumin',              'জিরা',              'gram',   true,      0.65,  0.75, 300.0),
      ('Spices',             'Cardamom',           'এলাচ',              'gram',   true,      4.40,  5.00,  50.0),
      ('Spices',             'Cinnamon',           'দারুচিনি',          'gram',   true,      0.55,  0.65, 100.0),
      ('Spices',             'Bay Leaf',           'তেজপাতা',           'gram',   true,      0.25,  0.35, 100.0),
      ('Spices',             'Onion',              'পেঁয়াজ',            'kg',     true,     55.0,  65.0,  10.0),
      ('Spices',             'Garlic',             'রসুন',              'kg',     true,    180.0, 200.0,   5.0),
      ('Spices',             'Ginger',             'আদা',               'kg',     true,    160.0, 180.0,   4.0),

      ('Sugar & Salt',       'Sugar',              'চিনি',              'kg',     true,    118.0, 128.0,  10.0),
      ('Sugar & Salt',       'Salt 1kg',           'লবণ ১ কেজি',        'packet', false,    38.0,  42.0,  15.0),
      ('Sugar & Salt',       'Molasses',           'গুড়',               'kg',     true,    120.0, 140.0,   3.0),

      ('Flour',              'Atta 2kg',           'আটা ২ কেজি',        'packet', false,   105.0, 115.0,  10.0),
      ('Flour',              'Loose Atta',         'খোলা আটা',          'kg',     true,     48.0,  55.0,  15.0),
      ('Flour',              'Maida',              'ময়দা',              'kg',     true,     55.0,  62.0,   8.0),
      ('Flour',              'Semolina',           'সুজি',              'kg',     true,     70.0,  80.0,   5.0),
      ('Flour',              'Besan',              'বেসন',              'kg',     true,     95.0, 110.0,   4.0),

      ('Dairy & Eggs',       'Powdered Milk 500g', 'গুঁড়া দুধ ৫০০ গ্রাম','piece', false,   420.0, 450.0,   5.0),
      ('Dairy & Eggs',       'Condensed Milk',     'কনডেন্সড মিল্ক',    'piece',  false,   110.0, 120.0,   6.0),
      ('Dairy & Eggs',       'Eggs (hali)',        'ডিম (হালি)',        'hali',   false,    42.0,  48.0,  10.0),
      ('Dairy & Eggs',       'Yoghurt 500g',       'দই ৫০০ গ্রাম',      'piece',  false,    90.0, 100.0,   4.0),
      ('Dairy & Eggs',       'Liquid Milk 500ml',  'তরল দুধ ৫০০ মি.লি.','piece',  false,    45.0,  50.0,   6.0),

      ('Biscuits & Snacks',  'Bread',              'পাউরুটি',           'piece',  false,    55.0,  60.0,   5.0),
      ('Biscuits & Snacks',  'Marie Biscuit',      'মেরি বিস্কুট',      'packet', false,    30.0,  35.0,  12.0),
      ('Biscuits & Snacks',  'Toast Biscuit',      'টোস্ট বিস্কুট',     'packet', false,    35.0,  40.0,  10.0),
      ('Biscuits & Snacks',  'Chanachur',          'চানাচুর',           'packet', false,    20.0,  25.0,  15.0),
      ('Biscuits & Snacks',  'Chips',              'চিপস',              'packet', false,    20.0,  25.0,  20.0),
      ('Biscuits & Snacks',  'Instant Noodles',    'নুডলস',             'packet', false,    18.0,  22.0,  24.0),
      ('Biscuits & Snacks',  'Lachchha Semai',     'লাচ্ছা সেমাই',      'packet', false,    45.0,  50.0,   6.0),

      ('Beverages',          'Tea Leaves 400g',    'চা পাতা ৪০০ গ্রাম', 'piece',  false,   180.0, 200.0,   5.0),
      ('Beverages',          'Instant Coffee',     'কফি',               'piece',  false,   250.0, 280.0,   3.0),
      ('Beverages',          'Cola 1L',            'কোক ১ লিটার',       'piece',  false,    90.0, 100.0,   8.0),
      ('Beverages',          'Drinking Water 1L',  'পানি ১ লিটার',      'piece',  false,    15.0,  20.0,  12.0),
      ('Beverages',          'Mango Juice',        'আমের জুস',          'piece',  false,    25.0,  30.0,  12.0),
      ('Beverages',          'Saline',             'খাবার স্যালাইন',    'packet', false,     5.0,   6.0,  30.0),

      ('Soap & Cleaning',    'Bath Soap',          'গোসলের সাবান',      'piece',  false,    45.0,  50.0,  12.0),
      ('Soap & Cleaning',    'Washing Soap',       'কাপড়ের সাবান',      'piece',  false,    28.0,  32.0,  12.0),
      ('Soap & Cleaning',    'Detergent 500g',     'ডিটারজেন্ট ৫০০ গ্রাম','packet',false,    90.0, 100.0,   8.0),
      ('Soap & Cleaning',    'Dishwash Bar',       'বাসন ধোয়ার সাবান',  'piece',  false,    22.0,  25.0,  10.0),
      ('Soap & Cleaning',    'Candle',             'মোমবাতি',           'packet', false,    35.0,  40.0,   6.0),
      ('Soap & Cleaning',    'Matchbox',           'দিয়াশলাই',          'piece',  false,     5.0,   6.0,  24.0),

      ('Personal Care',      'Shampoo Sachet',     'শ্যাম্পু (মিনি প্যাক)','piece',false,     8.0,  10.0,  40.0),
      ('Personal Care',      'Toothpaste 100g',    'টুথপেস্ট ১০০ গ্রাম','piece',  false,    95.0, 105.0,   6.0),
      ('Personal Care',      'Toothbrush',         'টুথব্রাশ',          'piece',  false,    40.0,  50.0,   8.0),
      ('Personal Care',      'Coconut Oil 100ml',  'নারিকেল তেল ১০০ মি.লি.','piece',false,   65.0,  75.0,   6.0),
      ('Personal Care',      'Body Lotion 100ml',  'লোশন ১০০ মি.লি.',   'piece',  false,   130.0, 145.0,   4.0),
      ('Personal Care',      'Sanitary Napkin',    'স্যানিটারি ন্যাপকিন','packet', false,   105.0, 120.0,   5.0),

      ('Baby Care',          'Diaper (piece)',     'ডায়াপার',           'piece',  false,    25.0,  30.0,  20.0),
      ('Baby Care',          'Baby Powder 100g',   'বেবি পাউডার',       'piece',  false,   110.0, 125.0,   3.0),

      ('Stationery',         'Exercise Book',      'খাতা',              'piece',  false,    30.0,  35.0,  10.0),
      ('Stationery',         'Ball Pen',           'কলম',               'piece',  false,     8.0,  10.0,  25.0),
      ('Stationery',         'Pencil',             'পেন্সিল',           'piece',  false,     5.0,   7.0,  25.0),

      ('Tobacco',            'Cigarette Packet',   'সিগারেট প্যাকেট',   'packet', false,   180.0, 190.0,  10.0),
      ('Tobacco',            'Biri Bundle',        'বিড়ি',              'bundle', false,    25.0,  30.0,  10.0)
    ) as t(cat, name, name_bn, unit, weighed, buy, sell, reorder)
  loop
    -- Idempotent: seeding twice must not double the catalogue. Matched on the
    -- English name because that is the stable key here; a shopkeeper who has
    -- renamed an item has made it his, and we leave it alone.
    if exists (
      select 1 from public.products p
       where p.shop_id = p_shop_id
         and lower(p.name) = lower(v_row.name)
    ) then
      continue;
    end if;

    select c.id into v_cat
      from public.categories c
     where c.shop_id = p_shop_id
       and lower(c.name) = lower(v_row.cat)
     limit 1;

    insert into public.products
      (shop_id, category_id, name, name_bn, unit, is_weighted,
       buy_price, sell_price, low_stock_threshold, is_active)
    values
      (p_shop_id, v_cat, v_row.name, v_row.name_bn,
       v_row.unit::unit_type, v_row.weighed,
       round(v_row.buy::numeric, 2), round(v_row.sell::numeric, 2),
       v_row.reorder::numeric, true);

    v_count := v_count + 1;
  end loop;

  insert into public.activity_log (shop_id, user_id, action, entity, meta)
  values (p_shop_id, auth.uid(), 'catalog.seeded', 'products',
          jsonb_build_object('count', v_count));

  return v_count;
end;
$$;

comment on function public.seed_starter_catalog(uuid) is
  'Seeds ~75 common Bangladeshi grocery items into a shop. Idempotent: skips any product whose English name already exists.';

revoke all on function public.seed_starter_catalog(uuid) from public;
grant execute on function public.seed_starter_catalog(uuid) to authenticated;
