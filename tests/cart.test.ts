import type { PaymentMethod, ProductStatus } from '@/lib/database.types'
import { LIMITS } from '@/lib/constants'
import {
  type CartAction,
  type CartState,
  belowCostLines,
  cartProblems,
  cartReducer,
  cartTotals,
  emptyCart,
  lineTotal,
  paymentMethodFor,
  shortLines,
  toSalePayload,
} from '@/screens/sell/cart'
import { deepEq, eq, notOk, ok, suite } from './_harness'

/**
 * The cart is where this app either adds up or does not, so it gets the most
 * assertions of anything here. Everything below is arithmetic and state; nothing
 * touches React, which is exactly why the reducer lives in its own module.
 */

/** A product with only the fields the cart reads, cast once so the tests stay readable. */
function product(over: Partial<ProductStatus> & { id: string }): ProductStatus {
  return {
    id: over.id,
    name: over.name ?? 'চাল',
    unit: over.unit ?? 'piece',
    is_weighted: over.is_weighted ?? false,
    sell_price: over.sell_price ?? 100,
    buy_price: over.buy_price ?? 80,
    stock: over.stock ?? 10,
    ...over,
  } as ProductStatus
}

function run(actions: CartAction[], from: CartState = emptyCart): CartState {
  return actions.reduce(cartReducer, from)
}

const rice = product({ id: 'p-rice', name: 'চাল', unit: 'kg', is_weighted: true, sell_price: 62, buy_price: 55, stock: 40 })
const soap = product({ id: 'p-soap', name: 'সাবান', sell_price: 35, buy_price: 28, stock: 6 })
const oil = product({ id: 'p-oil', name: 'তেল', unit: 'litre', is_weighted: true, sell_price: 180, buy_price: 172, stock: 4 })

/* ── Adding ─────────────────────────────────────────────────────────────── */

suite('add')
{
  const state = run([{ type: 'add', product: soap }])
  eq(state.lines.length, 1, 'one line')
  eq(state.lines[0].name, 'সাবান', 'name copied')
  eq(state.lines[0].qty, 1, 'piece starts at one')
  eq(state.lines[0].unit_price, 35, 'sell price copied')
  eq(state.lines[0].buy_price, 28, 'cost captured at add time, not looked up later')
  eq(state.lines[0].stock, 6, 'stock snapshotted for the short warning')
  eq(state.lines[0].product_id, 'p-soap', 'linked to the catalogue')
}
{
  // The scanner case: the same barcode twice is two units.
  const state = run([{ type: 'add', product: soap }, { type: 'add', product: soap }])
  eq(state.lines.length, 1, 'no second line for the same product')
  eq(state.lines[0].qty, 2, 'quantity bumped instead')
}
{
  const state = run([{ type: 'add', product: rice }])
  eq(state.lines[0].qty, 1, 'a weighed product starts at one whole unit — one kilo, not fifty grams')
  const twice = cartReducer(state, { type: 'add', product: rice })
  eq(twice.lines[0].qty, 2, 'and tapping it again means another kilo, not another 50g')
  const nudged = cartReducer(state, { type: 'bump', key: state.lines[0].key, delta: 1 })
  eq(nudged.lines[0].qty, 1.05, 'the fine step is 50g, and belongs to the +/- buttons')
}
{
  const lines: CartAction[] = []
  for (let i = 0; i < LIMITS.maxSaleLines + 5; i += 1) {
    lines.push({ type: 'add', product: product({ id: `p-${i}` }) })
  }
  const state = run(lines)
  eq(state.lines.length, LIMITS.maxSaleLines, 'the line ceiling holds')
}

suite('custom lines')
{
  const state = run([{ type: 'addCustom', name: '  খোলা বিস্কুট ', unitPrice: 12, qty: 3 }])
  eq(state.lines.length, 1, 'added')
  eq(state.lines[0].name, 'খোলা বিস্কুট', 'name trimmed')
  eq(state.lines[0].product_id, null, 'no catalogue row')
  eq(state.lines[0].buy_price, null, 'no cost, rather than a guessed one')
  eq(state.lines[0].qty, 3, 'quantity honoured')
}
{
  eq(run([{ type: 'addCustom', name: '', unitPrice: 12 }]).lines.length, 0, 'a nameless line is refused')
  eq(run([{ type: 'addCustom', name: 'x', unitPrice: 0 }]).lines.length, 0, 'a free line is refused')
}

/* ── Editing ────────────────────────────────────────────────────────────── */

suite('quantity')
{
  const base = run([{ type: 'add', product: soap }])
  const key = base.lines[0].key

  eq(cartReducer(base, { type: 'qty', key, qty: 7 }).lines[0].qty, 7, 'set')
  eq(cartReducer(base, { type: 'qty', key, qty: null }).lines[0].qty, 0, 'a cleared field is zero')
  eq(cartReducer(base, { type: 'qty', key, qty: null }).lines.length, 1, 'and does not delete the line')
  eq(cartReducer(base, { type: 'qty', key, qty: -4 }).lines[0].qty, 0, 'negative clamps to zero')
  eq(cartReducer(base, { type: 'qty', key, qty: 1e12 }).lines[0].qty, LIMITS.maxQty, 'and a stuck keypad clamps high')
  eq(cartReducer(base, { type: 'bump', key, delta: -1 }).lines[0].qty, 0, 'bumping below zero stops at zero')
  eq(cartReducer(base, { type: 'bump', key, delta: 3 }).lines[0].qty, 4, 'bumping up')

  const unknown = cartReducer(base, { type: 'qty', key: 'nope', qty: 9 })
  eq(unknown, base, 'an unknown key returns the same object, so React does not re-render')
}
{
  // Floating point: 0.1 + 0.05 must not appear in a shop as 0.15000000000000002.
  let state = run([{ type: 'add', product: rice }])
  const key = state.lines[0].key
  state = cartReducer(state, { type: 'qty', key, qty: 0.1 })
  state = cartReducer(state, { type: 'bump', key, delta: 1 })
  eq(state.lines[0].qty, 0.15, 'quantities stay clean to three places')
}

suite('price and discounts')
{
  const base = run([{ type: 'add', product: soap }])
  const key = base.lines[0].key
  eq(cartReducer(base, { type: 'price', key, unitPrice: 40.005 }).lines[0].unit_price, 40.01, 'price rounds to paisa')
  eq(cartReducer(base, { type: 'price', key, unitPrice: -5 }).lines[0].unit_price, 0, 'no negative price')
  eq(cartReducer(base, { type: 'price', key, unitPrice: null }).lines[0].unit_price, 0, 'cleared is zero')
  eq(cartReducer(base, { type: 'lineDiscount', key, amount: 5 }).lines[0].line_discount, 5, 'line discount')
  eq(cartReducer(base, { type: 'discount', amount: null }).discount, 0, 'cart discount cleared')
  eq(cartReducer(base, { type: 'discount', amount: 12.5 }).discount, 12.5, 'cart discount set')
}

suite('remove and clear')
{
  const base = run([{ type: 'add', product: soap }, { type: 'add', product: rice }])
  eq(base.lines.length, 2, 'two lines')
  const one = cartReducer(base, { type: 'remove', key: base.lines[0].key })
  eq(one.lines.length, 1, 'removed')
  eq(one.lines[0].product_id, 'p-rice', 'the right one survived')

  const dirty = run([
    { type: 'add', product: soap },
    { type: 'customer', customerId: 'c-1' },
    { type: 'paid', amount: 10 },
    { type: 'discount', amount: 5 },
    { type: 'note', text: 'x' },
    { type: 'method', method: 'bkash' },
  ])
  const cleared = cartReducer(dirty, { type: 'clear' })
  eq(cleared.lines.length, 0, 'lines gone')
  eq(cleared.customerId, null, 'the customer is dropped — the next person in the queue is a different person')
  eq(cleared.paid, null, 'paid resets to "in full"')
  eq(cleared.discount, 0, 'discount reset')
  eq(cleared.note, '', 'note reset')
  eq(cleared.method, 'cash', 'method back to cash')
}

/* ── Totals ─────────────────────────────────────────────────────────────── */

suite('totals')
{
  const t = cartTotals(emptyCart)
  eq(t.total, 0, 'an empty cart totals nothing')
  eq(t.paid, 0, 'and nothing is owed')
  eq(t.due, 0, 'no due')
  eq(t.change, 0, 'no change')
}
{
  // 2 soap at 35 = 70; 1.5 kg rice at 62 = 93. Gross 163.
  let state = run([{ type: 'add', product: soap }, { type: 'add', product: rice }])
  state = cartReducer(state, { type: 'qty', key: state.lines[0].key, qty: 2 })
  state = cartReducer(state, { type: 'qty', key: state.lines[1].key, qty: 1.5 })

  const t = cartTotals(state)
  eq(t.gross, 163, 'gross')
  eq(t.total, 163, 'total with no discount')
  eq(t.itemCount, 3.5, 'items counted across mixed units')
  eq(t.lineCount, 2, 'lines')
  eq(t.cost, 138.5, 'cost is 2×28 + 1.5×55')
  eq(t.profit, 24.5, 'profit')
  notOk(t.costPartial, 'every line has a cost')
  eq(t.paid, 163, 'paid defaults to the total — the common sale is paid in full')
  eq(t.due, 0, 'so nothing goes on the khata')
}
{
  let state = run([{ type: 'add', product: soap }])
  state = cartReducer(state, { type: 'qty', key: state.lines[0].key, qty: 4 })
  state = cartReducer(state, { type: 'lineDiscount', key: state.lines[0].key, amount: 10 })
  state = cartReducer(state, { type: 'discount', amount: 20 })

  const t = cartTotals(state)
  eq(t.gross, 140, 'gross before any discount')
  eq(t.lineDiscounts, 10, 'line discounts summed separately')
  eq(t.discount, 20, 'cart discount')
  eq(t.total, 110, 'total is gross minus both')
}
{
  // A fat-fingered discount cannot make a sale negative.
  let state = run([{ type: 'add', product: soap }])
  state = cartReducer(state, { type: 'discount', amount: 500 })
  const t = cartTotals(state)
  eq(t.discount, 35, 'the discount is capped at what the sale is worth')
  eq(t.total, 0, 'and the total floors at zero')
}
{
  // Part payment: ৳163 basket, ৳100 handed over.
  let state = run([{ type: 'add', product: soap }])
  state = cartReducer(state, { type: 'qty', key: state.lines[0].key, qty: 4 })
  state = cartReducer(state, { type: 'paid', amount: 100 })
  const t = cartTotals(state)
  eq(t.total, 140, 'total')
  eq(t.paid, 100, 'paid')
  eq(t.due, 40, 'the rest goes on the khata')
  eq(t.change, 0, 'and there is no change')
}
{
  // Overpayment: ৳500 for a ৳140 basket.
  let state = run([{ type: 'add', product: soap }])
  state = cartReducer(state, { type: 'qty', key: state.lines[0].key, qty: 4 })
  state = cartReducer(state, { type: 'paid', amount: 500 })
  const t = cartTotals(state)
  eq(t.change, 360, 'change out of the drawer')
  eq(t.due, 0, 'and nothing owed')
}
{
  const state = run([
    { type: 'add', product: soap },
    { type: 'addCustom', name: 'খোলা চা', unitPrice: 20, qty: 2 },
  ])
  const t = cartTotals(state)
  eq(t.gross, 75, 'custom lines count towards the total')
  eq(t.cost, 28, 'but contribute no cost')
  ok(t.costPartial, 'and the profit is flagged as partial rather than quietly wrong')
}
{
  const line = { qty: 3, unit_price: 33.33, line_discount: 0 } as never
  eq(lineTotal(line), 99.99, 'a line total rounds to paisa')
  eq(lineTotal({ qty: 1, unit_price: 10, line_discount: 40 } as never), 0, 'a line cannot go negative')
}

/* ── Method ─────────────────────────────────────────────────────────────── */

suite('payment method')
{
  const basket = run([{ type: 'add', product: soap }])
  const paidInFull = cartTotals(basket)
  eq(paymentMethodFor(basket, paidInFull), 'cash', 'a full cash sale is cash')

  const wallet = cartReducer(basket, { type: 'method', method: 'bkash' })
  eq(paymentMethodFor(wallet, cartTotals(wallet)), 'bkash' as PaymentMethod, 'a full wallet sale keeps the wallet')

  const partial = cartReducer(basket, { type: 'paid', amount: 20 })
  eq(paymentMethodFor(partial, cartTotals(partial)), 'mixed', 'part paid is mixed')

  const nothing = cartReducer(basket, { type: 'paid', amount: 0 })
  eq(paymentMethodFor(nothing, cartTotals(nothing)), 'due', 'nothing paid is a due')
}

/* ── Warnings and blocks ────────────────────────────────────────────────── */

suite('problems')
{
  deepEq(cartProblems(emptyCart, cartTotals(emptyCart)), ['empty'], 'an empty cart cannot be sold')

  const ok1 = run([{ type: 'add', product: soap }])
  deepEq(cartProblems(ok1, cartTotals(ok1)), [], 'a plain cash sale has no problems')

  const zero = cartReducer(ok1, { type: 'qty', key: ok1.lines[0].key, qty: 0 })
  ok(cartProblems(zero, cartTotals(zero)).includes('zeroQty'), 'a zero quantity blocks')

  const free = cartReducer(ok1, { type: 'price', key: ok1.lines[0].key, unitPrice: 0 })
  ok(cartProblems(free, cartTotals(free)).includes('zeroPrice'), 'a zero price blocks')

  const anonDue = cartReducer(ok1, { type: 'paid', amount: 0 })
  ok(
    cartProblems(anonDue, cartTotals(anonDue)).includes('dueWithoutCustomer'),
    'a due with nobody to owe it blocks — an anonymous debt is not a debt',
  )

  const named = cartReducer(anonDue, { type: 'customer', customerId: 'c-1' })
  deepEq(cartProblems(named, cartTotals(named)), [], 'and is fine once a customer is chosen')
}

suite('advisories')
{
  // 6 in stock, 9 being sold. Warned, not blocked: the shelf is the truth, not the
  // database, and a shopkeeper who has just found a forgotten carton is right.
  let state = run([{ type: 'add', product: soap }])
  state = cartReducer(state, { type: 'qty', key: state.lines[0].key, qty: 9 })
  eq(shortLines(state).length, 1, 'short stock is reported')
  deepEq(cartProblems(state, cartTotals(state)), [], 'but does not block the sale')

  const custom = run([{ type: 'addCustom', name: 'x', unitPrice: 5, qty: 100 }])
  eq(shortLines(custom).length, 0, 'a custom line has no stock to be short of')

  let cheap = run([{ type: 'add', product: oil }])
  cheap = cartReducer(cheap, { type: 'price', key: cheap.lines[0].key, unitPrice: 170 })
  eq(belowCostLines(cheap).length, 1, 'selling under cost is reported')
  deepEq(cartProblems(cheap, cartTotals(cheap)), [], 'and allowed — clearing stock at a loss is a real decision')
}

/* ── The wire format ────────────────────────────────────────────────────── */

suite('payload')
{
  let state = run([
    { type: 'add', product: rice },
    { type: 'addCustom', name: 'খোলা চা', unitPrice: 20, qty: 2 },
  ])
  state = cartReducer(state, { type: 'qty', key: state.lines[0].key, qty: 2 })
  state = cartReducer(state, { type: 'customer', customerId: 'c-9' })
  state = cartReducer(state, { type: 'paid', amount: 100 })
  state = cartReducer(state, { type: 'note', text: '  বাকি রাখল  ' })

  const payload = toSalePayload(state, 'shop-1', 'uuid-1', '2026-08-26T15:30:00.000Z')

  eq(payload.shop_id, 'shop-1', 'shop')
  eq(payload.client_uuid, 'uuid-1', 'the idempotency key travels with the sale')
  eq(payload.customer_id, 'c-9', 'customer')
  eq(payload.items.length, 2, 'both lines')
  eq(payload.items[0].product_id, 'p-rice', 'catalogue line carries an id')
  eq(payload.items[0].name, null, 'and no name — the server has one')
  eq(payload.items[0].qty, 2, 'quantity')
  eq(payload.items[0].buy_price, 55, 'cost travels, so the report is right later')
  eq(payload.items[1].product_id, null, 'custom line carries no id')
  eq(payload.items[1].name, 'খোলা চা', 'and its name instead')
  eq(payload.paid, 100, 'paid')
  eq(payload.payment_method, 'mixed', 'method derived from the money')
  eq(payload.note, 'বাকি রাখল', 'note trimmed')
  eq(payload.sold_at, '2026-08-26T15:30:00.000Z', 'stamped when the cashier tapped, not when the queue drained')

  const quiet = toSalePayload(run([{ type: 'add', product: soap }]), 's', 'u', 'now')
  eq(quiet.note, null, 'an empty note is null, not an empty string')
  eq(quiet.paid, 35, 'an untouched paid field sends the full total')
}
