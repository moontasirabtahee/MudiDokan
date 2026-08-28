import type { ExpiringRow, LowStockRow } from '@/lib/database.types'
import { formatDate } from '@/lib/format'
import {
  buildReorder,
  expiringValue,
  expiryLabel,
  expiryTone,
  groupReorder,
  reorderText,
  sortExpiring,
  sortReorder,
} from '@/screens/products/reorder'
import { deepEq, eq, notOk, ok, suite } from './_harness'

/**
 * The reorder list and the expiry list.
 *
 * These are asserted rather than eyeballed for one reason: the reorder text leaves the
 * app. It lands in the wholesaler's WhatsApp, and a wrong quantity in it becomes a van
 * loaded with the wrong goods — a mistake nobody notices until it is standing outside
 * the shop. The ordering rules matter for a quieter reason: they decide what a
 * shopkeeper reads first on a screen he checks in a hurry.
 */

/* ── Fixtures ───────────────────────────────────────────────────────────────── */

/**
 * `suggested_order_qty` defaults to the arithmetic the migration actually performs —
 * `greatest(low_stock_threshold * 2 - stock, low_stock_threshold)` — so a fixture
 * cannot quietly drift away from `v_low_stock`.
 */
function low(over: Partial<LowStockRow> & { id: string }): LowStockRow {
  const base = {
    name: 'Item',
    name_bn: null,
    unit: 'piece',
    is_weighted: false,
    sell_price: 100,
    buy_price: 80,
    stock: 2,
    low_stock_threshold: 5,
    category_name: null,
    category_name_bn: null,
    stock_value_at_cost: 0,
    days_to_expiry: null,
    is_active: true,
    ...over,
  } as LowStockRow

  return {
    ...base,
    suggested_order_qty:
      over.suggested_order_qty ??
      Math.max(base.low_stock_threshold * 2 - base.stock, base.low_stock_threshold),
  }
}

function expiring(over: Partial<ExpiringRow> & { id: string; days_to_expiry: number }): ExpiringRow {
  const days = over.days_to_expiry
  return {
    name: 'Item',
    name_bn: null,
    unit: 'piece',
    is_weighted: false,
    sell_price: 100,
    buy_price: 80,
    stock: 4,
    low_stock_threshold: 5,
    category_name: null,
    category_name_bn: null,
    stock_value_at_cost: 100,
    is_active: true,
    // The view's own ladder: < 0 expired, <= 7 urgent, <= 14 soon, else watch.
    expiry_state:
      over.expiry_state ?? (days < 0 ? 'expired' : days <= 7 ? 'urgent' : days <= 14 ? 'soon' : 'watch'),
    ...over,
  } as ExpiringRow
}

const GRAINS = { category_name: 'Grains', category_name_bn: 'চাল-ডাল' }
const WASH = { category_name: 'Toiletries', category_name_bn: 'সাবান-শ্যাম্পু' }

/** Ratio 0 — the shelf is bare. Suggests 20. */
const sugar = low({ id: 'p-sugar', name: 'Sugar', name_bn: 'চিনি', stock: 0, low_stock_threshold: 10, buy_price: 100, ...GRAINS })
/** Ratio 0.2. Suggests 9. */
const soap = low({ id: 'p-soap', name: 'Soap', name_bn: 'সাবান', stock: 1, low_stock_threshold: 5, buy_price: 30, ...WASH })
/** Ratio 0.5. Suggests 15. */
const tea = low({ id: 'p-tea', name: 'Tea', name_bn: 'চা', stock: 5, low_stock_threshold: 10, buy_price: 6 })
/** Ratio 0.8 — the least urgent, despite being 10 kg short. Suggests 60. */
const rice = low({ id: 'p-rice', name: 'Rice', name_bn: 'চাল', unit: 'kg', is_weighted: true, stock: 40, low_stock_threshold: 50, buy_price: 55, ...GRAINS })

/* ── Ordering the order ─────────────────────────────────────────────────────── */

suite('sortReorder ranks by how much of the buffer is left')
{
  const rows = sortReorder([rice, soap, tea, sugar])
  deepEq(
    rows.map((row) => row.id),
    ['p-sugar', 'p-soap', 'p-tea', 'p-rice'],
    'the emptiest shelf leads, not the biggest shortfall',
  )

  // 10 kg short of 50 is a comfortable shelf; 4 bars short of 5 is tomorrow's lost
  // sale. Sorting on units short would invert exactly this pair.
  const shortfallOrder = sortReorder([rice, soap])
  eq(shortfallOrder[0].id, 'p-soap', 'four bars of soap beat ten kilos of rice')

  eq(sortReorder([]).length, 0, 'an empty list sorts to an empty list')
  const input = [rice, sugar]
  sortReorder(input)
  eq(input[0].id, 'p-rice', 'and the caller’s array is left alone')
}

suite('sortReorder puts an empty shelf first without a special case')
{
  // A product with any stock at all has a positive ratio, so out-of-stock rows land on
  // zero and lead the list by construction. Asserted because it looks like an omission.
  const nearlyGone = low({ id: 'p-x', name: 'X', stock: 0.5, low_stock_threshold: 1000 })
  const rows = sortReorder([nearlyGone, sugar])
  eq(rows[0].id, 'p-sugar', 'nothing on the shelf outranks almost nothing')

  // A threshold of zero cannot be divided by, and such a row is only ever in the view
  // because its stock hit zero too.
  const noThreshold = low({ id: 'p-y', name: 'Y', name_bn: 'লবণ', stock: 0, low_stock_threshold: 0 })
  const both = sortReorder([soap, noThreshold, sugar])
  deepEq(both.map((row) => row.id), ['p-sugar', 'p-y', 'p-soap'], 'a zero threshold sorts as empty')
}

suite('buildReorder')
{
  const plan = buildReorder([rice, soap, tea, sugar])

  deepEq(
    plan.lines.map((line) => [line.name, line.qty]),
    [
      ['চিনি', 20],
      ['সাবান', 9],
      ['চা', 15],
      ['চাল', 60],
    ],
    'Bengali names, in urgency order, with the view’s suggested quantities',
  )

  eq(plan.out, 1, 'one of the four is not merely low but gone')
  eq(plan.cost, 20 * 100 + 9 * 30 + 15 * 6 + 60 * 55, 'costed at the last price paid')
  eq(plan.lines[0].cost, 2000, 'and each line carries its own share of it')
  ok(plan.lines[0].out, 'the bare shelf is flagged')
  notOk(plan.lines[1].out, 'one bar of soap is low, not out')

  eq(plan.lines[0].stock, 0, 'the current figure travels with the line')
  eq(plan.lines[3].unit, 'kg', 'so does the unit, because 60 of rice means kilos')

  const english = buildReorder([sugar], 'en')
  eq(english.lines[0].name, 'Sugar', 'an English shop gets an English list')
  eq(english.lines[0].category, 'Grains', 'category included')
  eq(buildReorder([sugar]).lines[0].category, 'চাল-ডাল', 'and Bengali by default')

  const empty = buildReorder([])
  eq(empty.cost, 0, 'nothing to order costs nothing')
  eq(empty.out, 0, 'and nothing is out')
}

suite('buildReorder rounds to something orderable')
{
  // 3.4 packets is not a quantity. Round up: a spare packet beats running out on
  // Thursday, and 'order 3.4' is an instruction the wholesaler has to interpret.
  const fiddly = low({ id: 'p-b', name: 'Biscuit', suggested_order_qty: 3.4 })
  eq(buildReorder([fiddly]).lines[0].qty, 4, 'counted goods round up to a whole one')

  const whole = low({ id: 'p-c', name: 'Candle', suggested_order_qty: 6 })
  eq(buildReorder([whole]).lines[0].qty, 6, 'and a whole number is left alone')

  // Weighed goods keep the three decimals the stock ledger works in.
  const weighed = low({ id: 'p-d', name: 'Dal', unit: 'kg', is_weighted: true, suggested_order_qty: 4.3754 })
  eq(buildReorder([weighed]).lines[0].qty, 4.375, 'weighed goods keep three decimals')

  const negative = low({ id: 'p-e', name: 'E', suggested_order_qty: -3 })
  eq(buildReorder([negative]).lines[0].qty, 0, 'and a negative suggestion never becomes an order')
}

/* ── Grouping ───────────────────────────────────────────────────────────────── */

suite('groupReorder')
{
  const plan = buildReorder([rice, soap, tea, sugar])
  const groups = groupReorder(plan.lines)

  deepEq(
    groups.map((group) => [group.category, group.lines.map((line) => line.name)]),
    [
      ['চাল-ডাল', ['চিনি', 'চাল']],
      ['সাবান-শ্যাম্পু', ['সাবান']],
      [null, ['চা']],
    ],
    'first appearance decides the order, later lines join their group, loose ones last',
  )

  eq(groupReorder([]).length, 0, 'no lines, no groups')
}

/* ── The message itself ─────────────────────────────────────────────────────── */

const ON = '2026-08-27'

suite('reorderText')
{
  const text = reorderText(buildReorder([rice, soap, tea, sugar]), {
    shopName: 'রহিম স্টোর',
    on: ON,
  })
  const lines = text.split('\n')

  eq(lines[0], 'রহিম স্টোর', 'the shop names itself first')
  ok(lines[1].startsWith('তোলার তালিকা · '), 'then what this is')
  ok(lines[1].includes(formatDate(ON, 'bn')), 'and which day it describes')

  deepEq(
    lines.slice(2),
    [
      '',
      'চাল-ডাল',
      '- চিনি  ২০ পিস',
      '- চাল  ৬০ কেজি',
      '',
      'সাবান-শ্যাম্পু',
      '- সাবান  ৯ পিস',
      '',
      'অন্যান্য',
      '- চা  ১৫ পিস',
      '',
      '৪টি পণ্য',
    ],
    'grouped, one product per line, Bengali digits and units throughout',
  )

  // The deliberate omissions. Each of these was a decision, so each gets an assertion.
  notOk(text.includes('৳'), 'no prices: what the shop paid is not the wholesaler’s business')
  notOk(/\d/.test(text), 'no Latin digits anywhere in a Bengali message')
  notOk(text.includes('শেষ হয়ে গেছে'), 'no out-of-stock markers — the ordering carries that')
}

suite('reorderText leaves out a heading it does not need')
{
  const text = reorderText(buildReorder([sugar]), { shopName: 'দোকান', on: ON })
  deepEq(
    text.split('\n').slice(2),
    ['', '- চিনি  ২০ পিস', '', '১টি পণ্য'],
    'one category is not a grouping, so it gets no heading',
  )

  const two = reorderText(buildReorder([sugar, soap]), { shopName: 'দোকান', on: ON })
  ok(two.includes('চাল-ডাল'), 'two categories do')
}

suite('reorderText in English')
{
  const text = reorderText(buildReorder([sugar, tea], 'en'), {
    shopName: 'Rahim Store',
    on: ON,
    locale: 'en',
  })
  ok(text.includes('- Sugar  20 pc'), 'English names, Latin digits, short unit')
  ok(text.includes('Grains'), 'the English category heading')
  ok(text.includes('Other'), 'and a heading for the uncategorised one')
  ok(text.includes('2 products'), 'with the count inflected')
}

suite('reorderText on an empty plan')
{
  // The screen hides the button in this case, but a share sheet opening on a blank
  // message is a worse failure than one opening on an honest zero.
  const text = reorderText(buildReorder([]), { shopName: 'দোকান', on: ON })
  ok(text.includes('দোকান'), 'still says whose shop it is')
  ok(text.includes('০টি পণ্য'), 'and admits there is nothing to order')
}

/* ── Expiry ─────────────────────────────────────────────────────────────────── */

const milk = expiring({ id: 'p-milk', name: 'Milk', name_bn: 'দুধ', days_to_expiry: -2, stock_value_at_cost: 300 })
const curd = expiring({ id: 'p-curd', name: 'Curd', name_bn: 'দই', days_to_expiry: 0, stock_value_at_cost: 100 })
const bread = expiring({ id: 'p-bread', name: 'Bread', name_bn: 'পাউরুটি', days_to_expiry: 0, stock_value_at_cost: 500 })
const juice = expiring({ id: 'p-juice', name: 'Juice', name_bn: 'জুস', days_to_expiry: 20, stock_value_at_cost: 50 })

suite('sortExpiring')
{
  const rows = sortExpiring([juice, curd, milk, bread])
  deepEq(
    rows.map((row) => row.id),
    ['p-milk', 'p-bread', 'p-curd', 'p-juice'],
    'soonest first, and among today’s the costlier loss leads',
  )

  eq(milk.expiry_state, 'expired', 'the fixture agrees with the view’s ladder')
  eq(curd.expiry_state, 'urgent', 'today is urgent')
  eq(juice.expiry_state, 'watch', 'three weeks out is only worth watching')

  // The view cannot produce this — `expiry_date is not null` is in its where clause —
  // but the column is nullable on the type, and a null sorting to the front would put
  // a product with no date at the top of the list of things about to go bad.
  const undated = expiring({ id: 'p-z', name: 'Z', days_to_expiry: 5 })
  const rows2 = sortExpiring([{ ...undated, days_to_expiry: null }, juice])
  eq(rows2[0].id, 'p-juice', 'a missing date sorts last, not first')
}

suite('expiringValue')
{
  eq(expiringValue([milk, curd, bread, juice]), 950, 'summed at cost — the money already spent')
  eq(expiringValue([]), 0, 'nothing at risk is zero, not NaN')

  const fractions = [
    expiring({ id: 'p-1', days_to_expiry: 1, stock_value_at_cost: 10.005 }),
    expiring({ id: 'p-2', days_to_expiry: 1, stock_value_at_cost: 0.1 }),
  ]
  eq(expiringValue(fractions), 10.11, 'and rounded to paisa rather than left with a float tail')
}

suite('expiryTone colours only what has to be acted on')
{
  eq(expiryTone('expired'), 'danger', 'money already gone')
  eq(expiryTone('urgent'), 'warn', 'inside a week')
  eq(expiryTone('soon'), 'neutral', 'two weeks is information, not an alarm')
  eq(expiryTone('watch'), 'neutral', 'and so is a month')
}

suite('expiryLabel')
{
  eq(expiryLabel(3), '৩ দিন বাকি', 'days left, in Bengali digits')
  eq(expiryLabel(-2), '২ দিন আগে শেষ', 'and days since, without a minus sign in the sentence')

  // '০ দিন বাকি' is arithmetically true and reads as nonsense, and this is the one row
  // that has to be dealt with before the shop closes.
  eq(expiryLabel(0), 'আজই শেষ', 'today gets its own sentence')

  eq(expiryLabel(null), '', 'no date, no label')

  eq(expiryLabel(1, 'en'), '1 day left', 'English inflects for one')
  eq(expiryLabel(2, 'en'), '2 days left', 'and for many')
  eq(expiryLabel(-1, 'en'), 'Expired 1 day ago', 'in both directions')
  eq(expiryLabel(0, 'en'), 'Expires today', 'and day zero there too')
}
