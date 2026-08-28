import type { CreateSalePayload, PaymentMethod, ProductStatus, SaleItemInput, UnitType } from '@/lib/database.types'
import { LIMITS } from '@/lib/constants'
import { qtyStep, roundTo } from '@/lib/format'
import { newId } from '@/lib/utils'

/**
 * The cart, as a reducer and some arithmetic.
 *
 * Pure on purpose, and in its own file for one reason: this is the money. Every
 * other mistake in this app is recoverable by looking again, and a cart that adds
 * up wrong takes money out of someone's hand. So it is a plain function of state
 * and an action, with no React and no network in it, and it has a test file.
 *
 * ## The server owns the totals
 *
 * Everything `cartTotals` computes is a *preview*. `create_sale` recomputes every
 * figure server-side from the item rows and ignores anything the client claims,
 * because a total posted by a browser is a total a modified browser can lie about.
 * The two must agree, and where they cannot the server wins — which is why the
 * rounding rule here (two places, half-up, per line then summed) is written the same
 * way in the RPC. If you change one, change both.
 *
 * ## `paid: null` means "in full"
 *
 * The overwhelmingly common sale in a grocery is paid in full, in cash, in one go.
 * Making the cashier type the amount every time to confirm that would add a step to
 * the only interaction that happens two hundred times a day. So `paid` starts null,
 * which `cartTotals` reads as the total, and only becomes a number when someone
 * deliberately enters one. A credit sale is then the explicit act it should be.
 */

export interface CartLine {
  /** Stable across re-renders and independent of the product, so a custom line has one too. */
  key: string
  product_id: string | null
  name: string
  unit: UnitType
  weighted: boolean
  qty: number
  unit_price: number
  /**
   * Captured when the line is added, not looked up at sale time.
   *
   * This is what makes a profit report honest six months later: it is the cost of
   * *this* packet of biscuits, not the cost of the packet the shopkeeper bought last
   * week at a different price. The RPC stores it on the sale item for the same
   * reason.
   */
  buy_price: number | null
  line_discount: number
  /** Stock when the line was added. Null for a custom line, which has none. */
  stock: number | null
}

export interface CartState {
  lines: CartLine[]
  discount: number
  customerId: string | null
  /** Null means "paid in full". See the note above. */
  paid: number | null
  /** What the cash was tendered as. `due` and `mixed` are derived, never set here. */
  method: PaymentMethod
  note: string
}

export const emptyCart: CartState = {
  lines: [],
  discount: 0,
  customerId: null,
  paid: null,
  method: 'cash',
  note: '',
}

export type CartAction =
  | { type: 'add'; product: ProductStatus }
  | { type: 'addCustom'; name: string; unitPrice: number; qty?: number; unit?: UnitType }
  | { type: 'qty'; key: string; qty: number | null }
  | { type: 'bump'; key: string; delta: number }
  | { type: 'price'; key: string; unitPrice: number | null }
  | { type: 'lineDiscount'; key: string; amount: number | null }
  | { type: 'remove'; key: string }
  | { type: 'discount'; amount: number | null }
  | { type: 'customer'; customerId: string | null }
  | { type: 'paid'; amount: number | null }
  | { type: 'method'; method: PaymentMethod }
  | { type: 'note'; text: string }
  | { type: 'clear' }

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const product = action.product
      const existing = state.lines.find((line) => line.product_id === product.id)
      if (existing) {
        // Scanning the same barcode twice means two units, not a second line that
        // has to be noticed and merged by a human.
        //
        // A whole unit even for weighed goods, deliberately. `qtyStep` is 50g,
        // which is the right *nudge* for the +/- buttons and quite wrong here:
        // tapping চাল twice means two kilos, and getting to two kilos by adding
        // fifty grams at a time is forty taps.
        return mapLine(state, existing.key, (line) => ({
          ...line,
          qty: clampQty(roundTo(line.qty + 1, 3)),
        }))
      }
      if (state.lines.length >= LIMITS.maxSaleLines) return state
      return {
        ...state,
        lines: [
          ...state.lines,
          {
            key: newId(),
            product_id: product.id,
            // The Bengali name when there is one. This string is what the cart row
            // and the receipt show, and a Bengali-first app that prints "Rice" on a
            // receipt has quietly stopped being one. Only display: the payload sends
            // `product_id` and lets the server name it.
            name: product.name_bn || product.name,
            unit: product.unit,
            weighted: product.is_weighted,
            // One of whatever it is. For rice that is a kilo — the cashier then
            // weighs it and types the real figure, which is the one interaction
            // this screen cannot avoid.
            qty: 1,
            unit_price: product.sell_price,
            buy_price: product.buy_price,
            line_discount: 0,
            stock: product.stock,
          },
        ],
      }
    }

    case 'addCustom': {
      // A loose item with no catalogue row: half a kilo of something in a sack, a
      // single cigarette. Refusing these is how a POS gets abandoned for a
      // calculator, so they are first-class — they just carry no cost, which means
      // the profit report knows to exclude them rather than guessing.
      if (state.lines.length >= LIMITS.maxSaleLines) return state
      const name = action.name.trim()
      if (!name || action.unitPrice <= 0) return state
      return {
        ...state,
        lines: [
          ...state.lines,
          {
            key: newId(),
            product_id: null,
            name,
            unit: action.unit ?? 'piece',
            weighted: false,
            qty: action.qty && action.qty > 0 ? action.qty : 1,
            unit_price: action.unitPrice,
            buy_price: null,
            line_discount: 0,
            stock: null,
          },
        ],
      }
    }

    case 'qty': {
      // A cleared field is zero, not a removed line. Deleting the row out from under
      // a cashier who is mid-correction loses the price they had already fixed.
      const qty = action.qty === null ? 0 : clampQty(action.qty)
      return mapLine(state, action.key, (line) => ({ ...line, qty }))
    }

    case 'bump': {
      // The fine step, matching the +/- buttons on `QtyField`: 50g for weighed
      // goods, one for counted ones.
      return mapLine(state, action.key, (line) => {
        const step = qtyStep(line.weighted) * action.delta
        return { ...line, qty: clampQty(roundTo(line.qty + step, 3)) }
      })
    }

    case 'price': {
      const price = action.unitPrice === null ? 0 : Math.max(0, roundTo(action.unitPrice, 2))
      return mapLine(state, action.key, (line) => ({ ...line, unit_price: price }))
    }

    case 'lineDiscount': {
      const amount = action.amount === null ? 0 : Math.max(0, roundTo(action.amount, 2))
      return mapLine(state, action.key, (line) => ({ ...line, line_discount: amount }))
    }

    case 'remove':
      return { ...state, lines: state.lines.filter((line) => line.key !== action.key) }

    case 'discount':
      return { ...state, discount: action.amount === null ? 0 : Math.max(0, roundTo(action.amount, 2)) }

    case 'customer':
      return { ...state, customerId: action.customerId }

    case 'paid':
      return { ...state, paid: action.amount === null ? null : Math.max(0, roundTo(action.amount, 2)) }

    case 'method':
      return { ...state, method: action.method }

    case 'note':
      return { ...state, note: action.text }

    case 'clear':
      // Not `emptyCart` by reference: the customer is deliberately dropped too. The
      // next person in the queue is a different person, and a cart that remembers
      // the last one puts a stranger's biscuits on Rahim's khata.
      return { ...emptyCart }

    default:
      return state
  }
}

function mapLine(state: CartState, key: string, fn: (line: CartLine) => CartLine): CartState {
  let changed = false
  const lines = state.lines.map((line) => {
    if (line.key !== key) return line
    changed = true
    return fn(line)
  })
  return changed ? { ...state, lines } : state
}

function clampQty(qty: number): number {
  if (!Number.isFinite(qty) || qty < 0) return 0
  return Math.min(qty, LIMITS.maxQty)
}

/* ── Arithmetic ─────────────────────────────────────────────────────────── */

export interface CartTotals {
  lineCount: number
  /** Summed quantity. Mixed units, so it is a count of things and not a weight. */
  itemCount: number
  /** Before any discount. */
  gross: number
  lineDiscounts: number
  /** Whole-sale discount, capped so a fat-fingered ৳৫০০ cannot make a sale negative. */
  discount: number
  total: number
  paid: number
  /** What goes on the khata. Never negative. */
  due: number
  /** What comes out of the drawer. Never negative. */
  change: number
  /** Cost of the lines that have one. Custom lines are excluded, not guessed at. */
  cost: number
  profit: number
  /** True when any line has no cost, so the screen can mark the profit as partial. */
  costPartial: boolean
}

export function lineTotal(line: CartLine): number {
  return Math.max(0, roundTo(line.qty * line.unit_price - line.line_discount, 2))
}

export function cartTotals(state: CartState): CartTotals {
  let gross = 0
  let lineDiscounts = 0
  let itemCount = 0
  let cost = 0
  let costPartial = false

  for (const line of state.lines) {
    gross = roundTo(gross + line.qty * line.unit_price, 2)
    lineDiscounts = roundTo(lineDiscounts + line.line_discount, 2)
    itemCount = roundTo(itemCount + line.qty, 3)
    if (line.buy_price === null) costPartial = true
    else cost = roundTo(cost + line.qty * line.buy_price, 2)
  }

  const afterLines = Math.max(0, roundTo(gross - lineDiscounts, 2))
  const discount = Math.min(state.discount, afterLines)
  const total = Math.max(0, roundTo(afterLines - discount, 2))
  const paid = state.paid === null ? total : state.paid

  return {
    lineCount: state.lines.length,
    itemCount,
    gross,
    lineDiscounts,
    discount,
    total,
    paid,
    due: Math.max(0, roundTo(total - paid, 2)),
    change: Math.max(0, roundTo(paid - total, 2)),
    cost,
    profit: roundTo(total - cost, 2),
    costPartial,
  }
}

/**
 * What to record the sale as.
 *
 * Derived rather than chosen, because the method follows from the money: nothing
 * paid is a due, part paid is mixed, all paid is however it was tendered. Asking a
 * cashier to also declare it is a second chance to get it wrong, and the two answers
 * would then disagree in the report.
 */
export function paymentMethodFor(state: CartState, totals: CartTotals): PaymentMethod {
  if (totals.total <= 0) return state.method
  if (totals.paid <= 0) return 'due'
  if (totals.paid < totals.total) return 'mixed'
  return state.method
}

/* ── What the screen has to stop, warn about, or allow ──────────────────── */

export type CartProblem =
  | 'empty'
  | 'tooManyLines'
  | 'zeroQty'
  | 'zeroPrice'
  /** A due sale with nobody to owe it. Blocking: an anonymous debt is not a debt. */
  | 'dueWithoutCustomer'

/**
 * Blocking problems only.
 *
 * Everything advisory — selling below cost, going past a credit limit, selling stock
 * the system thinks is not there — is deliberately *not* in this list. A shopkeeper
 * discounting to clear stock before it spoils, or extending credit to a neighbour he
 * has known for twenty years, is making a business decision with information this
 * app does not have. The screen shows him what he is doing and lets him do it.
 */
export function cartProblems(state: CartState, totals: CartTotals): CartProblem[] {
  const problems: CartProblem[] = []
  if (state.lines.length === 0) problems.push('empty')
  if (state.lines.length > LIMITS.maxSaleLines) problems.push('tooManyLines')
  if (state.lines.some((line) => line.qty <= 0)) problems.push('zeroQty')
  if (state.lines.some((line) => line.unit_price <= 0)) problems.push('zeroPrice')
  if (totals.due > 0 && !state.customerId) problems.push('dueWithoutCustomer')
  return problems
}

/** Lines being sold in greater quantity than the system believes is in stock. */
export function shortLines(state: CartState): CartLine[] {
  return state.lines.filter((line) => line.stock !== null && line.qty > line.stock)
}

/** Lines priced under what they cost. Advisory: clearing stock at a loss is a real decision. */
export function belowCostLines(state: CartState): CartLine[] {
  return state.lines.filter((line) => line.buy_price !== null && line.unit_price < line.buy_price)
}

/* ── The wire format ────────────────────────────────────────────────────── */

/**
 * Turn the cart into the RPC payload.
 *
 * `client_uuid` is generated by the caller and is the idempotency key for the whole
 * sale: the outbox stores it as the record id, and the RPC returns the original sale
 * unchanged if it sees the same one twice. That is what makes it safe for a phone to
 * retry a sale it never heard back about — the alternative is a shopkeeper who
 * cannot tell whether to ring it up again.
 *
 * `sold_at` is stamped here, at the moment the cashier tapped, not when the queue
 * happens to drain. A sale made at nine in the evening and sent at seven the next
 * morning belongs to the evening's takings.
 */
export function toSalePayload(
  state: CartState,
  shopId: string,
  clientUuid: string,
  soldAt: string = new Date().toISOString(),
): CreateSalePayload {
  const totals = cartTotals(state)
  const items: SaleItemInput[] = state.lines.map((line) => ({
    product_id: line.product_id,
    name: line.product_id ? null : line.name,
    qty: line.qty,
    unit: line.unit,
    unit_price: line.unit_price,
    buy_price: line.buy_price,
    line_discount: line.line_discount,
  }))

  return {
    shop_id: shopId,
    client_uuid: clientUuid,
    customer_id: state.customerId,
    items,
    discount: totals.discount,
    paid: totals.paid,
    payment_method: paymentMethodFor(state, totals),
    note: state.note.trim() || null,
    sold_at: soldAt,
  }
}
