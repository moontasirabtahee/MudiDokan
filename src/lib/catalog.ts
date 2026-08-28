import { LIMITS } from '@/lib/constants'
import type { ProductStatus, StockState } from '@/lib/database.types'
import { foldForSearch, matchesSearch, searchRank } from '@/lib/utils'

/**
 * The catalogue, as an array in the browser.
 *
 * Every product list in this app works the same way: the whole catalogue arrives in
 * one request, and finding, filtering and ordering happen on the device. That is not
 * a shortcut around pagination — it is the only design that works with the tower
 * down, which for a village shop is a normal Tuesday.
 *
 * Four screens need these operations — selling, the product list, stock, and a
 * purchase's line entry — so they live here rather than in whichever screen was
 * written first. Two definitions of "matches a product" would eventually disagree,
 * and the one the shopkeeper sees would be the wrong one.
 */

/* ── Matching ───────────────────────────────────────────────────────────────── */

/**
 * Name, Bengali name, code and barcode. All four, because people search by all four.
 *
 * The barcode is compared separately from the rest, and it has to be. `matchesSearch`
 * splits the query on spaces and asks that every token appear somewhere, which for a
 * code stored with the grouping the packet shows — '8 901234 567890' — gets the common
 * case exactly backwards: a *typed* '8 901234 567890' matches on three tokens, while
 * the thirteen bare digits a scanner sends match nothing at all. So separators come
 * out of both sides before the comparison.
 *
 * Containment rather than equality, because this feeds the results list and a
 * half-typed code should narrow it. `findBarcode` is the strict one.
 */
export function matchesProduct(query: string, product: ProductStatus): boolean {
  if (matchesSearch(query, product.name, product.name_bn, product.sku)) return true
  const needle = barcodeKey(query)
  return needle.length > 0 && barcodeKey(product.barcode).includes(needle)
}

/**
 * Rank against whichever name the query is actually in.
 *
 * `searchRank` privileges its first argument — an exact hit beats a prefix beats a
 * substring beats a match anywhere else. Passing only the English name would throw
 * that away for every Bengali query, which in this app is nearly all of them: 'চা'
 * would tie with 'চাল' and 'চানাচুর' at the bottom rank and the order would then be
 * decided by the *English* alphabet. So both names get a turn as the primary field and
 * the better rank wins.
 */
function rankProduct(query: string, product: ProductStatus): number {
  const byName = searchRank(query, product.name, product.sku, product.barcode)
  if (!product.name_bn) return byName
  return Math.min(byName, searchRank(query, product.name_bn, product.sku, product.barcode))
}

/**
 * What the row will read. Kept identical to the name `cartReducer` puts on a line and
 * to what `useI18n().name()` returns in Bengali, which is the locale nearly every
 * shopkeeper is in.
 */
export function displayName(product: Pick<ProductStatus, 'name' | 'name_bn'>): string {
  return product.name_bn || product.name
}

/**
 * Compared by code point rather than `localeCompare`, deliberately.
 *
 * The Bengali block is laid out in alphabetical order, so code-point order is the
 * right order — and a phone with a trimmed-down ICU would otherwise sort differently
 * from the one on the counter beside it. Two devices in one shop disagreeing about
 * where চিনি sits is the kind of small wrongness that costs trust in the whole app.
 */
function byDisplayName(a: ProductStatus, b: ProductStatus): number {
  const left = displayName(a)
  const right = displayName(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/* ── Ordering ───────────────────────────────────────────────────────────────── */

/**
 * Ranked results, best first, however many there are.
 *
 * Beyond the text rank, in-stock beats out-of-stock. Not because the sale should be
 * refused — it should not — but because when two products match equally the one on the
 * shelf is nearly always the one meant, and pushing an empty line to the top of the
 * list wastes a tap on a warning.
 *
 * The last tie is broken on the name the shopkeeper can actually see, which is the
 * Bengali one where there is one. Sorting a list of Bengali names by their English
 * translations produces an order with no visible logic to it — 'চিনি' before 'চাল'
 * because Sugar follows Rice — and a list whose order cannot be predicted has to be
 * read from the top every time.
 */
export function rankCatalog(products: readonly ProductStatus[], query: string): ProductStatus[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  return products
    .filter((product) => matchesProduct(trimmed, product))
    .sort((a, b) => {
      const rank = rankProduct(trimmed, a) - rankProduct(trimmed, b)
      if (rank !== 0) return rank
      const stocked = Number(b.stock > 0) - Number(a.stock > 0)
      if (stocked !== 0) return stocked
      return byDisplayName(a, b)
    })
}

/** The sell screen's search: the same ranking, cut to what fits above the keyboard. */
export function searchCatalog(
  products: readonly ProductStatus[],
  query: string,
  limit = LIMITS.searchResults,
): ProductStatus[] {
  return rankCatalog(products, query).slice(0, limit)
}

/** Browsing order, for a list with no query in it. */
export function sortByName(products: readonly ProductStatus[]): ProductStatus[] {
  return [...products].sort(byDisplayName)
}

/* ── Barcodes ───────────────────────────────────────────────────────────────── */

/**
 * A barcode, compared as bare characters.
 *
 * Whitespace comes out on both sides. Printed codes get stored with the grouping the
 * packet shows — '8 901234 567890' — and a scanner sends thirteen digits and a return,
 * so comparing them as typed would never match the thing the shopkeeper carefully
 * copied in.
 */
function barcodeKey(value: string | null | undefined): string {
  return foldForSearch(value).replace(/\s+/g, '')
}

export function findBarcode(
  products: readonly ProductStatus[],
  query: string,
): ProductStatus | null {
  const needle = barcodeKey(query)
  if (!needle) return null
  return products.find((product) => product.barcode && barcodeKey(product.barcode) === needle) ?? null
}

/**
 * What return means.
 *
 * Three things count as unambiguous, and nothing else does:
 *
 *  1. An exact barcode. This is the scanner, and it is the reason this function
 *     exists — a scanner types digits and presses return in about twenty
 *     milliseconds, and every one of those has to land on the right product.
 *  2. Exactly one result. There is nothing else it could have meant.
 *  3. An exact name match, even when other products also matched. Someone who typed
 *     'চা' in full and pressed return meant চা, not চাল or চানাচুর.
 *
 * Anything else returns null and the cashier taps the row he wants. Adding the
 * top-ranked guess would be faster on the good days and would, on the bad ones, put a
 * ৳৮০০ carton on a bill instead of a ৳৮ sachet — and the person holding the phone
 * would have no idea it had happened, because he was already looking at the customer.
 */
export function pickOnEnter(
  products: readonly ProductStatus[],
  query: string,
): ProductStatus | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const scanned = findBarcode(products, trimmed)
  if (scanned) return scanned

  const results = searchCatalog(products, trimmed, LIMITS.searchResults)
  if (results.length === 1) return results[0]

  const needle = foldForSearch(trimmed)
  const exact = results.filter(
    (product) =>
      foldForSearch(product.name) === needle || foldForSearch(product.name_bn) === needle,
  )
  return exact.length === 1 ? exact[0] : null
}

/* ── Filtering the product list ─────────────────────────────────────────────── */

/**
 * The five ways a shopkeeper wants to cut the list.
 *
 * There is no 'ok' tab. "Show me the products that are fine" is not a question anyone
 * has; the tabs that exist are the ones that lead to an action — order this, discount
 * this, fix this.
 */
export type CatalogTab = 'all' | 'low' | 'out' | 'expiring' | 'inactive'

export type CatalogCounts = Record<CatalogTab, number>

/**
 * Expiring, defined exactly as `v_expiring_soon` defines it — including `stock > 0`.
 *
 * A packet that went out of date while the shelf was already empty is not a problem to
 * be solved, and putting it in a list of things needing attention teaches the
 * shopkeeper that the list can be ignored. The window and the stock condition are
 * repeated from the view rather than inferred, so the badge and the server agree.
 */
export function isExpiring(product: ProductStatus): boolean {
  return (
    product.stock > 0 &&
    product.days_to_expiry !== null &&
    product.days_to_expiry <= LIMITS.expirySoonDays
  )
}

/**
 * Stock state, recomputed from the numbers on the row.
 *
 * The view already sends `stock_state`, and this agrees with it — but a product edited
 * on this phone a moment ago has a new threshold and a stale `stock_state`, and the
 * badge should change the instant the shopkeeper changes the number rather than after
 * the next fetch.
 */
export function stockState(product: ProductStatus): StockState {
  if (product.stock <= 0) return 'out'
  if (product.stock <= product.low_stock_threshold) return 'low'
  return 'ok'
}

export function filterCatalog(
  products: readonly ProductStatus[],
  tab: CatalogTab,
): ProductStatus[] {
  if (tab === 'inactive') return products.filter((product) => !product.is_active)

  const live = products.filter((product) => product.is_active)
  switch (tab) {
    case 'low':
      // 'low' is the reorder question, so an empty shelf belongs in it too. A tab that
      // said "running low" and hid the things that had run out entirely would send the
      // shopkeeper to the distributor with an incomplete list.
      return live.filter((product) => stockState(product) !== 'ok')
    case 'out':
      return live.filter((product) => stockState(product) === 'out')
    case 'expiring':
      return live.filter(isExpiring)
    default:
      return live
  }
}

/** One pass for all five badges, because five filters over a thousand rows is silly. */
export function catalogCounts(products: readonly ProductStatus[]): CatalogCounts {
  const counts: CatalogCounts = { all: 0, low: 0, out: 0, expiring: 0, inactive: 0 }
  for (const product of products) {
    if (!product.is_active) {
      counts.inactive += 1
      continue
    }
    counts.all += 1
    const state = stockState(product)
    if (state !== 'ok') counts.low += 1
    if (state === 'out') counts.out += 1
    if (isExpiring(product)) counts.expiring += 1
  }
  return counts
}

/**
 * What the list screen shows: the tab, narrowed by the search box.
 *
 * With a query the order is relevance; without one it is alphabetical, because those
 * are two different activities. Searching means "I know what I want"; browsing means
 * "let me see what I have", and a browse list that reorders itself is unusable.
 */
export function browseCatalog(
  products: readonly ProductStatus[],
  tab: CatalogTab,
  query: string,
): ProductStatus[] {
  const rows = filterCatalog(products, tab)
  const trimmed = query.trim()
  return trimmed ? rankCatalog(rows, trimmed) : sortByName(rows)
}
