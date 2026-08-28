import { translate } from '@/i18n/strings'
import type { ExpiringRow, ExpiryState, LowStockRow, ProductStatus, UnitType } from '@/lib/database.types'
import {
  DEFAULT_TZ,
  type Locale,
  displayName,
  formatDate,
  formatQty,
  roundTo,
} from '@/lib/format'

/**
 * The two lists the stock screen exists to produce.
 *
 * A shop's stock screen is not a report. It has exactly two jobs, and both of them
 * end with the shopkeeper doing something in the physical world: hand a list to the
 * মহাজন when the van comes, and move the packets that are about to go out of date to
 * the front of the shelf with a discount on them. Everything here serves one of
 * those two acts.
 *
 * ## Why the ordering lives here and not in the view
 *
 * `v_low_stock` and `v_expiring_soon` have no `order by`. That is not an oversight:
 * a Postgres view without one returns rows in whatever order the plan produced, so
 * the order has to be decided somewhere, and deciding it here means the list
 * reorders the instant a shopkeeper corrects a stock figure rather than after the
 * next fetch. The same reason `catalog.ts` recomputes `stock_state`.
 *
 * ## Why it is a separate file from the screen
 *
 * The reorder text is a real deliverable — it leaves the app and lands in somebody
 * else's WhatsApp — and text that goes to a third party should be tested rather
 * than eyeballed. None of this imports React, so `scripts/test.mjs` can run it.
 */

/* ── The order ──────────────────────────────────────────────────────────────── */

export interface ReorderLine {
  id: string
  name: string
  unit: UnitType
  /** What is on the shelf now. Zero, for the ones at the top of the list. */
  stock: number
  /** What to buy. See `suggestedFor` for why it is not the view's number verbatim. */
  qty: number
  category: string | null
  /** `qty` at the last price paid. An estimate, and labelled as one on screen. */
  cost: number
  out: boolean
}

export interface ReorderPlan {
  lines: ReorderLine[]
  /** How many are not merely low but gone. The number that makes the van urgent. */
  out: number
  cost: number
}

export interface ReorderGroup {
  category: string | null
  lines: ReorderLine[]
}

/**
 * How much of the buffer is left, as a fraction of it.
 *
 * A ratio rather than the shortfall in units, because the units are not comparable:
 * 40 kg of rice against a 50 kg threshold is a comfortable shelf, while 1 bar of
 * soap against a threshold of 5 is tomorrow's lost sale. Sorting on `threshold -
 * stock` would put the rice first and be wrong every time.
 *
 * Out-of-stock rows land on zero by construction and therefore lead the list without
 * needing a clause of their own — a product with any stock at all has a positive
 * ratio, however small.
 */
function remaining(row: LowStockRow): number {
  if (row.low_stock_threshold <= 0) return 0
  return Math.max(0, row.stock) / row.low_stock_threshold
}

/**
 * What to actually write down.
 *
 * The view suggests `threshold * 2 - stock`, floored at the threshold — enough to
 * get back to a full shelf plus a cushion. That arithmetic can land on 3.4 packets
 * of biscuits, and nobody orders 3.4 packets, so counted goods round *up*: the
 * shopkeeper who asked for 4 and needed 3.4 has a spare, and the one who asked for
 * 3 runs out on Thursday. Weighed goods keep three decimals, the same precision the
 * stock ledger works in.
 */
function suggestedFor(row: LowStockRow): number {
  const raw = Math.max(0, row.suggested_order_qty)
  return row.is_weighted ? roundTo(raw, 3) : Math.ceil(raw)
}

/**
 * The category as the shopkeeper named it, in the language he is reading.
 *
 * Separate from `displayName` because a category has its own pair of columns on the
 * status view rather than being a nested row.
 */
function categoryOf(row: ProductStatus, locale: Locale): string | null {
  if (locale === 'bn') return row.category_name_bn?.trim() || row.category_name
  return row.category_name
}

/** Emptiest shelf first, then whichever name the shopkeeper can read. */
export function sortReorder(rows: readonly LowStockRow[]): LowStockRow[] {
  return [...rows].sort((a, b) => {
    const left = remaining(a)
    const right = remaining(b)
    if (left !== right) return left - right
    const nameA = displayName(a)
    const nameB = displayName(b)
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0
  })
}

export function buildReorder(rows: readonly LowStockRow[], locale: Locale = 'bn'): ReorderPlan {
  const lines = sortReorder(rows).map<ReorderLine>((row) => {
    const qty = suggestedFor(row)
    return {
      id: row.id,
      name: displayName(row, locale),
      unit: row.unit,
      stock: row.stock,
      qty,
      category: categoryOf(row, locale),
      cost: roundTo(qty * row.buy_price, 2),
      out: row.stock <= 0,
    }
  })

  return {
    lines,
    out: lines.reduce((count, line) => count + (line.out ? 1 : 0), 0),
    cost: roundTo(
      lines.reduce((sum, line) => sum + line.cost, 0),
      2,
    ),
  }
}

/**
 * Grouped for reading, in the order the lines already have.
 *
 * A shop's categories are its aisles, and an order list that follows them can be
 * filled by walking the godown once. The uncategorised group goes last rather than
 * first so it cannot be mistaken for belonging to the heading above it.
 */
export function groupReorder(lines: readonly ReorderLine[]): ReorderGroup[] {
  const groups = new Map<string | null, ReorderLine[]>()
  for (const line of lines) {
    const existing = groups.get(line.category)
    if (existing) existing.push(line)
    else groups.set(line.category, [line])
  }

  const out: ReorderGroup[] = []
  for (const [category, rows] of groups) {
    if (category !== null) out.push({ category, lines: rows })
  }
  const loose = groups.get(null)
  if (loose) out.push({ category: null, lines: loose })
  return out
}

/**
 * The message that goes to the মহাজন.
 *
 * Names and quantities, and nothing else. Three things are deliberately absent:
 *
 *  - **Prices.** What the shop last paid is the shopkeeper's side of a negotiation
 *    that happens when the van arrives, and putting it in the message hands it over
 *    before the conversation starts. The estimated cost belongs on the shopkeeper's
 *    own screen, and that is where it is.
 *  - **Current stock.** The wholesaler is loading a van, not auditing a shelf.
 *  - **"Out of stock" markers.** The urgency is already in the order of the lines,
 *    and every extra word in a WhatsApp message is a word that can be misread.
 *
 * The date is a parameter rather than `new Date()` so this stays a function of its
 * inputs — and because a list composed on Tuesday and read on Thursday needs to say
 * which day it describes.
 */
export function reorderText(
  plan: ReorderPlan,
  options: { shopName: string; on: string; locale?: Locale; timeZone?: string },
): string {
  const { shopName, on, locale = 'bn', timeZone = DEFAULT_TZ } = options
  const groups = groupReorder(plan.lines)
  const out: string[] = []

  out.push(shopName)
  out.push(`${translate(locale, 'stock.reorderList')} · ${formatDate(on, locale, timeZone)}`)
  out.push('')

  for (const group of groups) {
    // One category is not a grouping, it is a redundant heading. Headings appear
    // only when there is something for them to separate.
    if (groups.length > 1) {
      out.push(group.category ?? translate(locale, 'common.other'))
    }
    for (const line of group.lines) {
      out.push(`- ${line.name}  ${formatQty(line.qty, line.unit, locale)}`)
    }
    out.push('')
  }

  out.push(translate(locale, 'product.count', { count: plan.lines.length }))
  return out.join('\n')
}

/* ── What is about to go out of date ────────────────────────────────────────── */

/** Soonest first; among rows expiring the same day, the costliest loss first. */
export function sortExpiring(rows: readonly ExpiringRow[]): ExpiringRow[] {
  return [...rows].sort((a, b) => {
    const left = a.days_to_expiry ?? Number.POSITIVE_INFINITY
    const right = b.days_to_expiry ?? Number.POSITIVE_INFINITY
    if (left !== right) return left - right
    if (a.stock_value_at_cost !== b.stock_value_at_cost) {
      return b.stock_value_at_cost - a.stock_value_at_cost
    }
    const nameA = displayName(a)
    const nameB = displayName(b)
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0
  })
}

/**
 * What the shelf stands to lose, at cost.
 *
 * At cost and not at retail, because retail is money that was never earned while
 * cost is money that was already spent. Showing the retail figure would inflate the
 * scare and, worse, would make discounting look like a bigger loss than it is —
 * when discounting is precisely what this list is for.
 */
export function expiringValue(rows: readonly ExpiringRow[]): number {
  return roundTo(
    rows.reduce((sum, row) => sum + row.stock_value_at_cost, 0),
    2,
  )
}

/**
 * Only two of the four states get a colour.
 *
 * Expired is money already gone, so red. Inside a week is red's warning shade. The
 * other two are information, and painting them would leave a screen of coloured
 * pills with no hierarchy in it — the exact failure mode `StockTag` avoids by
 * leaving healthy stock as plain text.
 */
export function expiryTone(state: ExpiryState): 'danger' | 'warn' | 'neutral' {
  if (state === 'expired') return 'danger'
  if (state === 'urgent') return 'warn'
  return 'neutral'
}

/**
 * '৩ দিন বাকি', '২ দিন আগে শেষ', 'আজই শেষ'.
 *
 * Day zero gets its own sentence. '০ দিন বাকি' is arithmetically true and reads as
 * nonsense, and this is the one row on the screen that has to be acted on before the
 * shop closes.
 */
export function expiryLabel(days: number | null, locale: Locale = 'bn'): string {
  if (days == null) return ''
  if (days < 0) return translate(locale, 'stock.expiredDaysAgo', { days: Math.abs(days) })
  if (days === 0) return translate(locale, 'stock.expiresToday')
  return translate(locale, 'stock.daysLeft', { days })
}
