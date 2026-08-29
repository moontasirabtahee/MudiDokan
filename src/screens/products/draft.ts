import type { ProductDraft } from '@/data/products'
import type { StringKey } from '@/i18n/strings'
import { DEFAULTS, WEIGHED_UNITS } from '@/lib/constants'
import type { ProductStatus, UnitType } from '@/lib/database.types'
import { roundTo } from '@/lib/format'

/**
 * The product form, as a value.
 *
 * Everything the form decides lives here: what a blank one starts as, what an existing
 * product turns into, which fields stop a save and which only warn, and what finally
 * goes to the server. The screen does the tapping; this does the thinking.
 *
 * Prices are `number | null` rather than `number`, because a blank price box and a
 * price of zero are different facts and a form that cannot tell them apart will
 * silently save ৳০ for a product the shopkeeper simply had not filled in yet.
 */

export interface DraftState {
  name: string
  name_bn: string
  category_id: string | null
  sku: string
  barcode: string
  unit: UnitType
  is_weighted: boolean
  buy_price: number | null
  sell_price: number | null
  low_stock_threshold: number | null
  expiry_date: string
  note: string
  opening_stock?: number | null
}

export function emptyDraft(name = ''): DraftState {
  return {
    name: name.trim(),
    name_bn: '',
    category_id: null,
    sku: '',
    barcode: '',
    unit: 'piece',
    is_weighted: false,
    buy_price: null,
    sell_price: null,
    low_stock_threshold: DEFAULTS.lowStockThreshold,
    expiry_date: '',
    note: '',
    opening_stock: null,
  }
}

export function draftFromProduct(product: ProductStatus): DraftState {
  return {
    name: product.name,
    name_bn: product.name_bn ?? '',
    category_id: product.category_id,
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    unit: product.unit,
    is_weighted: product.is_weighted,
    buy_price: product.buy_price,
    sell_price: product.sell_price,
    low_stock_threshold: product.low_stock_threshold,
    expiry_date: product.expiry_date ?? '',
    note: product.note ?? '',
    opening_stock: null,
  }
}

/**
 * Changing the unit ticks "sold by weight" for you.
 *
 * Nobody knows what "sold by weight" means as an abstraction, and everybody knows
 * rice comes in kilos. So the unit — which the shopkeeper picks confidently — decides
 * the flag, which he would otherwise leave wrong. The switch stays on screen because
 * loose sweets sold by the piece and packets sold by the kilo both exist; it is a
 * correction to a good guess rather than a question.
 */
export function setUnit(state: DraftState, unit: UnitType): DraftState {
  return { ...state, unit, is_weighted: WEIGHED_UNITS.includes(unit) }
}

/* ── What the shopkeeper is told ────────────────────────────────────────────── */

/** The fields a message can attach to. Anything else is a whole-form advisory. */
export type DraftField = 'name' | 'sell_price' | 'buy_price' | 'low_stock_threshold'

export interface DraftCheck {
  /** False means the save button does nothing. Only the four blocking rules set it. */
  ok: boolean
  errors: Partial<Record<DraftField, StringKey>>
  /**
   * Things worth saying and not worth refusing over. Rendered as amber notes beside
   * the save button, never through `Field`'s `error` — a field painted red for a
   * legitimate choice teaches the shopkeeper that red means nothing.
   */
  advisories: StringKey[]
}

/**
 * Four things block a save, and they are all "this product could not be sold".
 *
 * A product with no name cannot be found; a product with no price cannot be rung up;
 * a negative price or threshold is a typo with no valid reading. Everything else —
 * selling below cost, no cost at all, no Bengali name, a date already past — is a
 * decision a shopkeeper is allowed to make, and this app is not his supervisor.
 */
export function validateDraft(state: DraftState, today?: string): DraftCheck {
  const errors: DraftCheck['errors'] = {}
  const advisories: StringKey[] = []

  if (!state.name.trim()) errors.name = 'product.needName'

  if (state.sell_price === null) errors.sell_price = 'product.needSellPrice'
  else if (state.sell_price < 0) errors.sell_price = 'error.invalidAmount'

  if (state.buy_price !== null && state.buy_price < 0) errors.buy_price = 'error.invalidAmount'

  if (state.low_stock_threshold !== null && state.low_stock_threshold < 0) {
    errors.low_stock_threshold = 'error.invalidAmount'
  }

  if (state.opening_stock !== null && state.opening_stock !== undefined && state.opening_stock < 0) {
    errors.low_stock_threshold = 'error.invalidAmount'
  }

  const sell = state.sell_price
  const buy = state.buy_price

  if (sell !== null && buy !== null && buy > 0 && sell < buy) {
    advisories.push('product.priceBelowCost')
  }
  if (buy === null || buy === 0) {
    // Not an error: plenty of stock arrives without a paper bill. But profit for this
    // product will read as pure margin, and a shopkeeper who is not told that will
    // one day trust a profit figure that is wrong.
    advisories.push('product.noCostPrice')
  }
  if (!state.name_bn.trim()) {
    advisories.push('product.noBengaliName')
  }
  if (today && state.expiry_date && state.expiry_date < today) {
    advisories.push('product.expiryPast')
  }

  return { ok: Object.keys(errors).length === 0, errors, advisories }
}

/** Margin, live, as the two numbers a shopkeeper thinks in: taka and per cent. */
export function marginOf(state: DraftState): { amount: number; pct: number | null } {
  const sell = state.sell_price ?? 0
  const buy = state.buy_price ?? 0
  const amount = roundTo(sell - buy, 2)
  return { amount, pct: sell > 0 ? roundTo((amount / sell) * 100, 1) : null }
}

/* ── What goes to the server ────────────────────────────────────────────────── */

/** An empty box means "no value", not an empty string. Unique indexes care. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The payload.
 *
 * Null-coalescing rather than validation: this runs only after `validateDraft` passed,
 * and the fallbacks exist so the types line up rather than to paper over a blank
 * field. `stock` is deliberately absent — it belongs to `stock_ledger` and its
 * trigger, and the only honest way to change it is an adjustment that records why.
 */
export function toProductDraft(state: DraftState): ProductDraft {
  return {
    name: state.name.trim(),
    name_bn: orNull(state.name_bn),
    category_id: state.category_id,
    sku: orNull(state.sku),
    barcode: orNull(state.barcode),
    unit: state.unit,
    is_weighted: state.is_weighted,
    buy_price: state.buy_price ?? 0,
    sell_price: state.sell_price ?? 0,
    low_stock_threshold: state.low_stock_threshold ?? 0,
    expiry_date: orNull(state.expiry_date),
    note: orNull(state.note),
    opening_stock: state.opening_stock ?? null,
  }
}

/**
 * Has anything actually changed?
 *
 * Compared through the payload rather than field by field, so trailing spaces and an
 * empty box that was already null do not count as edits. Used for the "leave without
 * saving?" question, which has to be right in both directions: asking when nothing
 * changed trains the shopkeeper to dismiss it, and not asking when something did loses
 * his work.
 */
export function isDirty(state: DraftState, original: DraftState): boolean {
  return JSON.stringify(toProductDraft(state)) !== JSON.stringify(toProductDraft(original))
}
