import {
  type AdjustState,
  balanceAfter,
  checkAdjust,
  deltaOf,
  emptyAdjust,
  reasonOf,
  toAdjustPayload,
} from '@/screens/products/adjust'
import {
  type DraftState,
  draftFromProduct,
  emptyDraft,
  isDirty,
  marginOf,
  setUnit,
  toProductDraft,
  validateDraft,
} from '@/screens/products/draft'
import { parseSpokenProduct } from '@/lib/voice'
import type { ProductStatus } from '@/lib/database.types'
import { deepEq, eq, notOk, ok, suite } from './_harness'

/**
 * The product form and the stock adjustment.
 *
 * Both are places where a wrong sign or a silently-coerced blank costs the shopkeeper
 * real money — a ৳০ selling price on a product he sells all day, or a correction that
 * subtracts when it should add. Neither is visible to a type checker, so both are
 * asserted here.
 */

/* ── The product form ───────────────────────────────────────────────────────── */

function filled(over: Partial<DraftState> = {}): DraftState {
  return { ...emptyDraft('Tea'), name_bn: 'চা', buy_price: 6, sell_price: 8, ...over }
}

suite('emptyDraft')
{
  const blank = emptyDraft()
  eq(blank.name, '', 'nothing typed yet')
  eq(blank.sell_price, null, 'a blank price box is null, not zero')
  eq(blank.buy_price, null, 'and so is cost')
  eq(blank.unit, 'piece', 'most things are sold one at a time')
  notOk(blank.is_weighted, 'so not by weight')
  eq(blank.low_stock_threshold, 5, 'with a threshold worth having rather than none')

  eq(emptyDraft('  চিনি  ').name, 'চিনি', 'a name carried in from a search is trimmed')
}

suite('setUnit')
{
  const state = emptyDraft('Rice')
  eq(setUnit(state, 'kg').is_weighted, true, 'kilos mean weighed, without being asked')
  eq(setUnit(state, 'litre').is_weighted, true, 'so do litres')
  eq(setUnit(state, 'packet').is_weighted, false, 'packets do not')
  eq(setUnit(state, 'kg').unit, 'kg', 'and the unit itself is set')

  // The switch is a correction to a good guess, so switching back to a counted unit
  // has to clear the flag again — otherwise a mistap leaves 'packet, sold by weight'.
  const weighed = setUnit(state, 'kg')
  eq(setUnit(weighed, 'piece').is_weighted, false, 'and picking a counted unit clears it')
}

suite('validateDraft blocks only what cannot be sold')
{
  ok(validateDraft(filled()).ok, 'a filled form saves')

  const noName = validateDraft(filled({ name: '   ' }))
  notOk(noName.ok, 'a product with no name cannot be found, so it cannot be saved')
  eq(noName.errors.name, 'product.needName', 'and it says which field')

  const noPrice = validateDraft(filled({ sell_price: null }))
  notOk(noPrice.ok, 'nor one with no selling price')
  eq(noPrice.errors.sell_price, 'product.needSellPrice', 'named plainly rather than "required"')

  const negative = validateDraft(filled({ sell_price: -5 }))
  notOk(negative.ok, 'a negative price is a typo with no valid reading')
  eq(negative.errors.sell_price, 'error.invalidAmount', 'and is reported as one')

  notOk(validateDraft(filled({ buy_price: -1 })).ok, 'the same for cost')
  notOk(validateDraft(filled({ low_stock_threshold: -2 })).ok, 'and for the threshold')

  ok(validateDraft(filled({ sell_price: 0 })).ok, 'a price of zero is odd but it is a decision')
  ok(validateDraft(filled({ low_stock_threshold: null })).ok, 'no threshold means no warnings, which is allowed')
}

suite('validateDraft advises without refusing')
{
  const belowCost = validateDraft(filled({ buy_price: 10, sell_price: 8 }))
  ok(belowCost.ok, 'selling at a loss is a decision a shopkeeper is allowed to make')
  ok(belowCost.advisories.includes('product.priceBelowCost'), 'but he is told he is making it')

  const noCost = validateDraft(filled({ buy_price: null }))
  ok(noCost.ok, 'stock often arrives without a paper bill')
  ok(noCost.advisories.includes('product.noCostPrice'), 'and the profit figure will read too high')
  ok(
    validateDraft(filled({ buy_price: 0 })).advisories.includes('product.noCostPrice'),
    'a cost of zero says the same thing as no cost',
  )
  notOk(
    validateDraft(filled({ buy_price: 0, sell_price: 8 })).advisories.includes('product.priceBelowCost'),
    'and does not also claim the price is below cost, which would be two warnings for one gap',
  )

  ok(
    validateDraft(filled({ name_bn: '' })).advisories.includes('product.noBengaliName'),
    'a missing Bengali name is worth mentioning on a Bengali screen',
  )
  notOk(
    validateDraft(filled()).advisories.includes('product.noBengaliName'),
    'and not mentioning when it is there',
  )

  const past = validateDraft(filled({ expiry_date: '2020-01-01' }), '2026-08-27')
  ok(past.ok, 'an expired product can be entered — that is how it gets written off')
  ok(past.advisories.includes('product.expiryPast'), 'with a word about the date')
  notOk(
    validateDraft(filled({ expiry_date: '2027-01-01' }), '2026-08-27').advisories.includes('product.expiryPast'),
    'a future date is silent',
  )
  notOk(
    validateDraft(filled({ expiry_date: '2020-01-01' })).advisories.includes('product.expiryPast'),
    'and with no today to compare against, nothing is claimed',
  )
}

suite('marginOf')
{
  deepEq(marginOf(filled({ buy_price: 6, sell_price: 8 })), { amount: 2, pct: 25 }, 'taka and per cent')
  deepEq(marginOf(filled({ buy_price: 10, sell_price: 8 })), { amount: -2, pct: -25 }, 'a loss shows as a loss')
  deepEq(marginOf(filled({ buy_price: null, sell_price: 8 })), { amount: 8, pct: 100 }, 'no cost reads as all margin')
  eq(marginOf(filled({ sell_price: 0 })).pct, null, 'per cent of nothing is not zero, it is unanswerable')
  eq(marginOf(filled({ buy_price: 7, sell_price: 9.5 })).amount, 2.5, 'and half-taka prices survive')

  // One decimal, exactly as v_products_status rounds margin_pct. Two definitions of
  // the same percentage would show the form and the list disagreeing.
  eq(marginOf(filled({ buy_price: 2, sell_price: 3 })).pct, 33.3, 'rounded the way the view rounds it')
}

suite('toProductDraft')
{
  const payload = toProductDraft(filled({ sku: '  SP-01 ', barcode: '', note: '   ' }))
  eq(payload.name, 'Tea', 'the name is trimmed')
  eq(payload.sku, 'SP-01', 'and so is the code')
  eq(payload.barcode, null, 'an empty box is null, not an empty string a unique index would collide on')
  eq(payload.note, null, 'whitespace counts as empty')
  eq(payload.buy_price, 6, 'prices pass through')
  eq(payload.low_stock_threshold, 5, 'as does the threshold')

  const blanks = toProductDraft(emptyDraft('Salt'))
  eq(blanks.buy_price, 0, 'a null cost reaches the server as zero, since the column is not nullable')
  eq(blanks.name_bn, null, 'but a missing name stays absent rather than becoming ""')
  notOk('stock' in blanks, 'stock is never in the payload — only an adjustment may move it')
}

suite('draftFromProduct and isDirty')
{
  const product = {
    id: 'p1',
    name: 'Tea',
    name_bn: 'চা',
    category_id: 'c1',
    sku: null,
    barcode: null,
    unit: 'piece',
    is_weighted: false,
    buy_price: 6,
    sell_price: 8,
    low_stock_threshold: 5,
    expiry_date: null,
    note: null,
    stock: 12,
  } as ProductStatus

  const loaded = draftFromProduct(product)
  eq(loaded.name_bn, 'চা', 'the Bengali name loads')
  eq(loaded.sku, '', 'a null code becomes an empty box rather than the string "null"')
  eq(loaded.expiry_date, '', 'and so does a null date')

  notOk(isDirty(loaded, loaded), 'an untouched form is not dirty')
  notOk(isDirty({ ...loaded, name: 'Tea  ' }, loaded), 'nor is a trailing space')
  notOk(isDirty({ ...loaded, sku: '  ' }, loaded), 'nor whitespace in a box that was already empty')
  ok(isDirty({ ...loaded, sell_price: 9 }, loaded), 'a changed price is')
  ok(isDirty({ ...loaded, name_bn: '' }, loaded), 'and so is clearing the Bengali name')
}

/* ── The stock adjustment ───────────────────────────────────────────────────── */

function counted(value: number | null): AdjustState {
  return { ...emptyAdjust('count'), counted: value }
}

function removed(value: number | null, reason: AdjustState['reason'] = 'damage'): AdjustState {
  return { ...emptyAdjust('remove'), amount: value, reason }
}

suite('deltaOf')
{
  eq(deltaOf(counted(12), 15), -3, 'counting fewer than the app thinks is a subtraction')
  eq(deltaOf(counted(20), 15), 5, 'and counting more is an addition')
  eq(deltaOf(counted(15), 15), 0, 'agreeing is no movement')
  eq(deltaOf(counted(0), 15), -15, 'an empty shelf takes it all off')
  eq(deltaOf(counted(null), 15), 0, 'nothing entered moves nothing')

  eq(deltaOf(removed(3), 15), -3, 'a loss is always a subtraction')
  eq(deltaOf(removed(-3), 15), -3, 'even if the number arrives signed')
  eq(deltaOf(removed(20), 15), -20, 'and it is not capped at what the app thinks is there')
  eq(deltaOf(removed(null), 15), 0, 'nothing entered, nothing moved')

  eq(deltaOf(counted(2.5), 1.25), 1.25, 'weighed stock keeps its fractions')
  eq(deltaOf(counted(0.3), 0.1), 0.2, 'and does not drift the way floating point wants to')
}

suite('balanceAfter')
{
  eq(balanceAfter(counted(12), 15), 12, 'a count is the balance, by definition')
  eq(balanceAfter(removed(3), 15), 12, 'a loss comes off the current figure')
  eq(balanceAfter(removed(20), 15), -5, 'and is allowed to go below zero')
  eq(balanceAfter(counted(2.5), 1.25), 2.5, 'fractions survive here too')
}

suite('reasonOf')
{
  eq(reasonOf(counted(12)), 'correction', 'a count is a correction, whatever the picker shows')
  eq(reasonOf({ ...counted(12), reason: 'theft' }), 'correction', 'even after the mode was switched back')
  eq(reasonOf(removed(3, 'expiry')), 'expiry', 'a loss carries the reason chosen')
}

suite('checkAdjust')
{
  ok(checkAdjust(counted(12), 15).ok, 'a real count saves')
  notOk(checkAdjust(counted(null), 15).ok, 'an empty box does not')
  eq(checkAdjust(counted(null), 15).error, 'stock.needCount', 'and says what is missing')
  eq(checkAdjust(counted(15), 15).error, 'stock.noChange', 'a count that matches is not worth a ledger row')
  eq(checkAdjust(counted(-1), 15).error, 'error.invalidAmount', 'a negative count is a typo')

  ok(checkAdjust(removed(3), 15).ok, 'a loss saves')
  eq(checkAdjust(removed(null), 15).error, 'stock.needAmount', 'a blank amount does not')
  eq(checkAdjust(removed(0), 15).error, 'stock.needAmount', 'and neither does zero')

  const negative = checkAdjust(removed(20), 15)
  ok(negative.ok, 'taking off more than the app thinks is there is still allowed')
  ok(negative.advisories.includes('stock.willGoNegative'), 'because the app is the one that might be wrong')
  deepEq(checkAdjust(removed(3), 15).advisories, [], 'and an ordinary loss says nothing extra')
  ok(
    checkAdjust(counted(0), -5).advisories.length === 0,
    'counting a shelf empty when the app already reads negative fixes it rather than warning',
  )
}

suite('toAdjustPayload')
{
  const payload = toAdjustPayload({ ...counted(12), note: '  gunechi ' }, {
    shopId: 's1',
    productId: 'p1',
    current: 15,
    clientUuid: 'u1',
  })
  eq(payload.delta, -3, 'the signed difference, not the counted number')
  eq(payload.reason, 'correction', 'a count is a correction')
  eq(payload.note, 'gunechi', 'the note is trimmed')
  eq(payload.client_uuid, 'u1', 'and carries the idempotency key the RPC dedupes on')

  const loss = toAdjustPayload(removed(2, 'theft'), {
    shopId: 's1',
    productId: 'p1',
    current: 15,
    clientUuid: 'u2',
  })
  eq(loss.delta, -2, 'a loss is negative')
  eq(loss.reason, 'theft', 'with the reason the shopkeeper chose')
  eq(loss.note, null, 'and an empty note is absent rather than ""')
}

suite('parseSpokenProduct')
{
  // User's exact reported phrase:
  const p1 = parseSpokenProduct('চিনি কেন 120 বেঁচে 130 স্টক 50 কেজি')
  eq(p1.name, 'চিনি', 'extracts product name চিনি')
  eq(p1.buyPrice, 120, 'extracts buy price from কেন 120')
  eq(p1.sellPrice, 130, 'extracts sell price from বেঁচে 130')
  eq(p1.stock, 50, 'extracts stock 50')
  eq(p1.unit, 'kg', 'extracts unit kg')

  const p2 = parseSpokenProduct('সয়াবিন তেল ১ লিটার কেনা ১৮০ বেচা ১৯৫ স্টক ২০ বোতল')
  eq(p2.name, 'সয়াবিন তেল ১ লিটার', 'preserves description in name')
  eq(p2.buyPrice, 180, 'extracts bengali digits buy price')
  eq(p2.sellPrice, 195, 'extracts bengali digits sell price')
  eq(p2.stock, 20, 'extracts bengali digits stock')
  eq(p2.unit, 'litre', 'extracts litre')

  const p3 = parseSpokenProduct('ডিম হালি কেনা ৩৬ টাকা বিক্রি ৪২ টাকা স্টক ১০০ হালি')
  eq(p3.name, 'ডিম হালি', 'extracts egg name')
  eq(p3.buyPrice, 36, 'extracts buy price')
  eq(p3.sellPrice, 42, 'extracts sell price')
  eq(p3.stock, 100, 'extracts stock')
  eq(p3.unit, 'hali', 'extracts hali')

  const p4 = parseSpokenProduct('মিনিকেট চাল ৫০ কেজি কেনা ৩০০০ বেচা ৩২০০ স্টক ১০ বস্তা')
  eq(p4.buyPrice, 3000, 'extracts 3000 buy price')
  eq(p4.sellPrice, 3200, 'extracts 3200 sell price')
  eq(p4.stock, 10, 'extracts 10 stock')
  eq(p4.unit, 'sack', 'extracts sack')
}

