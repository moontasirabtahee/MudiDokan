import type { ProductStatus } from '@/lib/database.types'
import { type CartState, cartReducer, emptyCart } from '@/screens/sell/cart'
import { CART_TTL_MS, reviveCart, serialiseCart } from '@/screens/sell/cartStorage'
import {
  DECAY_AT,
  bumpFavourite,
  parseFavourites,
  topFavourites,
} from '@/screens/sell/favourites'
import { invoiceLabel, receiptFromCart, receiptText } from '@/screens/sell/receipt'
import { deepEq, eq, match, notOk, ok, suite } from './_harness'

/**
 * The sell screen's supporting logic: what a stored cart is allowed to come back as,
 * how the frequent-product tiles learn and forget, and what a receipt says when the
 * sale has not reached the server yet. Finding a product is `catalog.test.ts` — that
 * moved to `lib/` once the product list needed the same ordering.
 *
 * All of it is pure by design — the screen itself is the only part that needs a browser
 * — so all of it is checked here rather than by tapping through a phone.
 */

/* ── Fixtures ───────────────────────────────────────────────────────────────── */

function product(over: Partial<ProductStatus> & { id: string }): ProductStatus {
  return {
    id: over.id,
    name: 'Item',
    name_bn: null,
    sku: null,
    barcode: null,
    unit: 'piece',
    is_weighted: false,
    sell_price: 100,
    buy_price: 80,
    stock: 10,
    ...over,
  } as ProductStatus
}

const tea = product({ id: 'p-tea', name: 'Tea', name_bn: 'চা', sell_price: 8 })
const rice = product({ id: 'p-rice', name: 'Rice', name_bn: 'চাল', unit: 'kg', is_weighted: true, sell_price: 62 })

/** A cart holding one line, built through the reducer so the shape is never guessed. */
function oneLine(): CartState {
  return cartReducer(emptyCart, { type: 'add', product: tea })
}

/* ── The cart line's name ───────────────────────────────────────────────────── */

suite('cart line naming')
{
  const state = cartReducer(emptyCart, { type: 'add', product: rice })
  eq(state.lines[0].name, 'চাল', 'the Bengali name is what the cart and receipt show')

  const noBengali = cartReducer(emptyCart, { type: 'add', product: product({ id: 'x', name: 'Matchbox' }) })
  eq(noBengali.lines[0].name, 'Matchbox', 'and the English one when there is no Bengali')
}

/* ── Reviving a stored cart ─────────────────────────────────────────────────── */

suite('reviveCart')
{
  const now = 1_700_000_000_000
  const stored = serialiseCart('shop-1', oneLine(), now)

  const back = reviveCart(stored, 'shop-1', now + 60_000)
  ok(back !== null, 'a minute-old cart from this shop comes back')
  eq(back?.lines.length, 1, 'with its line')
  eq(back?.lines[0].name, 'চা', 'and the line intact')

  notOk(reviveCart(stored, 'shop-2', now), 'a cart from another shop is refused')
  notOk(reviveCart(stored, 'shop-1', now + CART_TTL_MS + 1), 'and one past the window')
  ok(reviveCart(stored, 'shop-1', now + CART_TTL_MS) !== null, 'but not one exactly at it')

  // A phone that has just found a tower after a night in flight mode.
  notOk(reviveCart(stored, 'shop-1', now - 5_000), 'a clock that jumped backwards is refused')

  notOk(reviveCart(null, 'shop-1', now), 'nothing stored')
  notOk(reviveCart('', 'shop-1', now), 'an empty string')
  notOk(reviveCart('{ not json', 'shop-1', now), 'unparseable text')
  notOk(reviveCart('"a string"', 'shop-1', now), 'a JSON value that is not an object')
  notOk(reviveCart(serialiseCart('shop-1', emptyCart, now), 'shop-1', now), 'an empty cart is not worth restoring')
  notOk(
    reviveCart(JSON.stringify({ shopId: 'shop-1', cart: oneLine() }), 'shop-1', now),
    'a record with no timestamp',
  )
  notOk(
    reviveCart(JSON.stringify({ shopId: 'shop-1', savedAt: now, cart: { lines: 'nope' } }), 'shop-1', now),
    'lines that are not an array',
  )
}

suite('reviveCart refuses a malformed line')
{
  const now = 1_700_000_000_000
  const base = oneLine()

  /** Store one line with a single field replaced, and try to read it back. */
  function withLine(over: Record<string, unknown>): CartState | null {
    const raw = JSON.stringify({
      shopId: 'shop-1',
      savedAt: now,
      cart: { ...base, lines: [{ ...base.lines[0], ...over }] },
    })
    return reviveCart(raw, 'shop-1', now)
  }

  ok(withLine({}) !== null, 'an untouched line is fine')
  notOk(withLine({ key: '' }), 'a line with no key')
  notOk(withLine({ key: 7 }), 'a key of the wrong type')
  notOk(withLine({ name: '' }), 'a line with no name')
  notOk(withLine({ qty: 'two' }), 'a quantity that is not a number')
  notOk(withLine({ unit_price: null }), 'a price that went missing in a schema change')
  notOk(withLine({ unit_price: Number.POSITIVE_INFINITY }), 'a price that is not finite')
  notOk(withLine({ line_discount: undefined }), 'a discount that went missing')
}

suite('reviveCart rebuilds rather than spreads')
{
  const now = 1_700_000_000_000
  const raw = JSON.stringify({
    shopId: 'shop-1',
    savedAt: now,
    cart: { ...oneLine(), leftover: 'from an older version', discount: 'nonsense', method: 5 },
  })
  const back = reviveCart(raw, 'shop-1', now)
  ok(back !== null, 'the cart still comes back')
  notOk('leftover' in (back as object), 'but a key that no longer exists cannot ride along')
  eq(back?.discount, 0, 'a non-numeric discount falls back to zero')
  eq(back?.method, 'cash', 'and a bad method to cash')
  eq(back?.paid, null, 'paid stays null, meaning "in full"')
}

/* ── Favourites ─────────────────────────────────────────────────────────────── */

suite('bumpFavourite')
{
  const once = bumpFavourite({}, 'a')
  deepEq(once, { a: 1 }, 'a first tap')
  deepEq(bumpFavourite(once, 'a'), { a: 2 }, 'and a second')
  deepEq(bumpFavourite(once, 'b'), { a: 1, b: 1 }, 'a different product')

  const before = { a: 5, b: 3 }
  bumpFavourite(before, 'a')
  deepEq(before, { a: 5, b: 3 }, 'the input is never mutated')
}

suite('favourite decay')
{
  // One below the threshold, so the next tap crosses it.
  const busy = { a: DECAY_AT - 40, b: 30, c: 9, once: 1 }
  const after = bumpFavourite(busy, 'c')

  eq(after.a, Math.floor((DECAY_AT - 40) / 2), 'every count is halved')
  eq(after.b, 15, 'including the middling ones')
  eq(after.c, 5, 'and the one just tapped')
  notOk('once' in after, 'anything that halves to nothing is dropped')

  let total = 0
  for (const value of Object.values(after)) total += value
  ok(total < DECAY_AT, 'so the store cannot grow without bound')

  // The tapped product surviving matters most in the edge case: a single tap on
  // something new, in the same moment everything halves.
  const fresh = bumpFavourite({ a: DECAY_AT }, 'new')
  eq(fresh.new, 1, 'a product tapped as the halving happens still counts')
}

suite('topFavourites')
{
  deepEq(topFavourites({ a: 1, b: 9, c: 4 }), ['b', 'c', 'a'], 'most tapped first')
  deepEq(topFavourites({ a: 3, b: 3, c: 3 }), ['a', 'b', 'c'], 'ties break on id, so tiles hold still')
  deepEq(topFavourites({ b: 3, a: 3 }), ['a', 'b'], 'regardless of insertion order')
  eq(topFavourites({ a: 9, b: 8, c: 7, d: 6, e: 5, f: 4, g: 3 }).length, 6, 'six tiles')
  eq(topFavourites({ a: 9, b: 8, c: 7 }, 2).length, 2, 'or however many are asked for')
  deepEq(topFavourites({}), [], 'nothing learnt yet')
}

suite('parseFavourites')
{
  deepEq(parseFavourites('{"a":3}'), { a: 3 }, 'a stored map')
  deepEq(parseFavourites(null), {}, 'nothing stored')
  deepEq(parseFavourites('{ broken'), {}, 'unparseable text')
  deepEq(parseFavourites('[1,2]'), {}, 'an array is not a map')
  deepEq(parseFavourites('{"a":"3","b":2}'), { b: 2 }, 'a count that is not a number is dropped')
  deepEq(parseFavourites('{"a":0,"b":-4,"c":2}'), { c: 2 }, 'and so are zero and negative counts')
}

/* ── Receipts ───────────────────────────────────────────────────────────────── */

const shop = {
  name: 'Karim Store',
  name_bn: 'করিম স্টোর',
  phone: '01711000000',
  receipt_footer: 'ধন্যবাদ',
  invoice_prefix: 'INV',
}

suite('receiptFromCart')
{
  let cart = cartReducer(emptyCart, { type: 'add', product: rice })
  cart = cartReducer(cart, { type: 'qty', key: cart.lines[0].key, qty: 2 })
  cart = cartReducer(cart, { type: 'lineDiscount', key: cart.lines[0].key, amount: 4 })
  cart = cartReducer(cart, { type: 'discount', amount: 10 })
  cart = cartReducer(cart, { type: 'paid', amount: 100 })

  const data = receiptFromCart(cart, shop, 'করিম স্টোর', { soldAt: '2026-08-27T09:00:00.000Z' })

  eq(data.lines.length, 1, 'one line')
  eq(data.lines[0].name, 'চাল', 'named as the cart names it')
  eq(data.subtotal, 124, 'the subtotal is before any discount')
  eq(data.discount, 14, 'and the discount line adds the per-line and whole-sale ones together')
  eq(data.total, 110, 'so that subtotal minus discount is the total')
  eq(data.paid, 100, 'what was handed over')
  eq(data.due, 10, 'what goes on the khata')
  eq(data.change, 0, 'and nothing comes out of the drawer')
  eq(data.invoiceNo, null, 'no invoice number until the server allocates one')
  eq(data.invoicePrefix, 'INV', 'the prefix is the shop’s')
  eq(data.balanceAfter, null, 'and the resulting balance is only known once it lands')
}

suite('invoiceLabel')
{
  const queued = receiptFromCart(oneLine(), shop, 'করিম স্টোর', { soldAt: '2026-08-27T09:00:00.000Z' })
  eq(invoiceLabel(queued, 'bn'), 'বিক্রি জমা রাখা হয়েছে', 'a queued sale says so instead of inventing a number')
  eq(invoiceLabel(queued, 'en'), 'Sale saved on this phone', 'in either language')

  const confirmed = receiptFromCart(oneLine(), shop, 'করিম স্টোর', {
    soldAt: '2026-08-27T09:00:00.000Z',
    invoiceNo: 1024,
  })
  eq(invoiceLabel(confirmed, 'en'), 'INV-1024', 'a confirmed one is prefix and number')
  eq(invoiceLabel(confirmed, 'bn'), 'INV-১০২৪', 'in Bengali digits, and ungrouped — it is an identifier, not money')
}

suite('receiptText')
{
  const data = receiptFromCart(oneLine(), shop, 'করিম স্টোর', {
    soldAt: '2026-08-27T09:00:00.000Z',
    invoiceNo: 7,
    customerName: 'রহিম',
    balanceAfter: 250,
  })
  const text = receiptText(data, 'bn', 'Asia/Dhaka')

  match(text, /করিম স্টোর/, 'the shop name is at the top')
  match(text, /01711000000/, 'with its phone number')
  match(text, /INV-৭/, 'the invoice number')
  match(text, /চা/, 'the item')
  match(text, /রহিম/, 'the customer')
  match(text, /ধন্যবাদ/, 'and the shop’s footer line')
  notOk(text.includes('<'), 'plain text, because this lands in WhatsApp')
  ok(text.split('\n').length > 5, 'one thing per line rather than columns aligned with spaces')
}
