import {
  type CatalogTab,
  browseCatalog,
  catalogCounts,
  displayName,
  filterCatalog,
  findBarcode,
  isExpiring,
  matchesProduct,
  pickOnEnter,
  rankCatalog,
  searchCatalog,
  sortByName,
  stockState,
} from '@/lib/catalog'
import type { ProductStatus } from '@/lib/database.types'
import { deepEq, eq, notOk, ok, suite } from './_harness'

/**
 * Finding and filtering the catalogue.
 *
 * Four screens lean on this file, and two of the rules in it are ones a static check
 * cannot see: that a scanned barcode matches a code stored with the grouping printed on
 * the packet, and that a list of Bengali names comes out in Bengali order. Both were
 * wrong before these assertions existed.
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
    low_stock_threshold: 5,
    days_to_expiry: null,
    is_active: true,
    ...over,
  } as ProductStatus
}

const tea = product({ id: 'p-tea', name: 'Tea', name_bn: 'চা', sell_price: 8 })
const rice = product({ id: 'p-rice', name: 'Rice', name_bn: 'চাল', unit: 'kg', is_weighted: true, sell_price: 62 })
const snack = product({ id: 'p-snack', name: 'Chanachur', name_bn: 'চানাচুর', sell_price: 20 })
const soap = product({ id: 'p-soap', name: 'Soap', name_bn: 'সাবান', sku: 'SP-01', sell_price: 35, stock: 0 })
const biscuit = product({
  id: 'p-bis',
  name: 'Biscuit',
  name_bn: 'বিস্কুট',
  barcode: '8 901234 567890',
  sell_price: 15,
})

const catalog = [tea, rice, snack, soap, biscuit]

/* ── Matching ───────────────────────────────────────────────────────────────── */

suite('matchesProduct')
{
  ok(matchesProduct('চা', tea), 'the Bengali name')
  ok(matchesProduct('tea', tea), 'the English one')
  ok(matchesProduct('TEA', tea), 'case-insensitively')
  ok(matchesProduct('sp-01', soap), 'the code')
  ok(matchesProduct('8901234567890', biscuit), 'the barcode, ignoring how it was grouped')
  ok(matchesProduct('890123', biscuit), 'and a half-typed barcode still narrows the list')
  notOk(matchesProduct('তেল', tea), 'and nothing else')
}

suite('displayName')
{
  eq(displayName(rice), 'চাল', 'the Bengali name is what a row reads')
  eq(displayName({ name: 'Matchbox', name_bn: null }), 'Matchbox', 'and the English one when there is none')
  eq(displayName({ name: 'Matchbox', name_bn: '' }), 'Matchbox', 'an empty string counts as none')
}

/* ── Ordering ───────────────────────────────────────────────────────────────── */

suite('searchCatalog ordering')
{
  const found = searchCatalog(catalog, 'চা').map((row) => row.id)
  eq(found[0], 'p-tea', 'an exact Bengali hit comes first, ahead of the longer names it prefixes')
  // চানাচুর then চাল, because ন precedes ল. Sorted on the Bengali name: by the English
  // one it would be Chanachur then Rice, which is the same order here by coincidence
  // and would not be for চাল and চিনি.
  deepEq(found, ['p-tea', 'p-snack', 'p-rice'], 'then the prefix matches, in Bengali order')

  const bengaliOrder = searchCatalog(
    [
      product({ id: 'p-sugar', name: 'Sugar', name_bn: 'চিনি' }),
      product({ id: 'p-rice2', name: 'Rice', name_bn: 'চাল' }),
    ],
    'চ',
  ).map((row) => row.id)
  deepEq(bengaliOrder, ['p-rice2', 'p-sugar'], 'চাল before চিনি, though Rice follows nothing alphabetically')

  eq(searchCatalog(catalog, '  ').length, 0, 'a blank query matches nothing at all')
  eq(searchCatalog(catalog, 'চা', 2).length, 2, 'the limit is respected')
  eq(rankCatalog(catalog, 'চা').length, 3, 'and rankCatalog has no limit, for a list that scrolls')

  // Stock only breaks a tie; it never removes a row. A shopkeeper looking at the
  // shelf knows better than the number in the database.
  const stocked = product({ id: 'p-soap2', name: 'Soap Bar', name_bn: 'সাবান বার', stock: 4 })
  const both = searchCatalog([soap, stocked], 'সাবান').map((row) => row.id)
  deepEq(both, ['p-soap', 'p-soap2'], 'an exact name still outranks being in stock')

  const equal = searchCatalog(
    [soap, product({ id: 'p-soap3', name: 'Soap', name_bn: 'সাবান', stock: 6 })],
    'সাবান',
  ).map((row) => row.id)
  deepEq(equal, ['p-soap3', 'p-soap'], 'but between equals, what is on the shelf wins')
}

suite('sortByName')
{
  const sorted = sortByName(catalog).map((row) => row.id)
  deepEq(
    sorted,
    ['p-tea', 'p-snack', 'p-rice', 'p-bis', 'p-soap'],
    'চা, চানাচুর, চাল, বিস্কুট, সাবান — Bengali order, not Biscuit-Chanachur-Rice-Soap-Tea',
  )
  deepEq(catalog.map((row) => row.id), ['p-tea', 'p-rice', 'p-snack', 'p-soap', 'p-bis'], 'the input is not reordered')
}

/* ── Barcodes ───────────────────────────────────────────────────────────────── */

suite('findBarcode')
{
  eq(findBarcode(catalog, '8901234567890')?.id, 'p-bis', 'a scanner sends bare digits')
  eq(findBarcode(catalog, '8 901234 567890')?.id, 'p-bis', 'and a person types the printed grouping')
  notOk(findBarcode(catalog, '890123456789'), 'a partial barcode is not a barcode')
  notOk(findBarcode(catalog, ''), 'nothing typed')
  notOk(findBarcode(catalog, 'চা'), 'and a name is not one either')
}

suite('pickOnEnter')
{
  eq(pickOnEnter(catalog, '8901234567890')?.id, 'p-bis', 'a scan resolves to its product')
  eq(pickOnEnter(catalog, 'সাবান')?.id, 'p-soap', 'so does the only match for a name')
  eq(pickOnEnter(catalog, 'চা')?.id, 'p-tea', 'and an exact name, even with longer names also matching')
  eq(pickOnEnter(catalog, 'চাল')?.id, 'p-rice', 'the longer name works the same way')

  notOk(pickOnEnter(catalog, ''), 'an empty query does nothing')
  notOk(pickOnEnter(catalog, '   '), 'nor does whitespace')
  notOk(pickOnEnter(catalog, 'তেল'), 'nor a query that matches nothing')

  // The case this function exists to refuse.
  const twins = [
    product({ id: 'a', name: 'Biscuit Small', name_bn: 'বিস্কুট ছোট', sell_price: 8 }),
    product({ id: 'b', name: 'Biscuit Carton', name_bn: 'বিস্কুট কার্টন', sell_price: 800 }),
  ]
  notOk(pickOnEnter(twins, 'বিস্কুট'), 'two plausible matches means the cashier taps one')

  const duplicates = [
    product({ id: 'a', name: 'Salt', name_bn: 'লবণ' }),
    product({ id: 'b', name: 'Salt', name_bn: 'লবণ' }),
  ]
  notOk(pickOnEnter(duplicates, 'লবণ'), 'two rows with the same name is also ambiguous')
}

/* ── Stock state ────────────────────────────────────────────────────────────── */

suite('stockState')
{
  eq(stockState(product({ id: 'a', stock: 0 })), 'out', 'an empty shelf')
  eq(stockState(product({ id: 'a', stock: -2 })), 'out', 'and a negative one, which a correction can produce')
  eq(stockState(product({ id: 'a', stock: 5, low_stock_threshold: 5 })), 'low', 'at the threshold is already low')
  eq(stockState(product({ id: 'a', stock: 6, low_stock_threshold: 5 })), 'ok', 'one above it is not')
  eq(stockState(product({ id: 'a', stock: 4, low_stock_threshold: 0 })), 'ok', 'a threshold of zero only ever means out')

  // The point of recomputing rather than reading the view's column: the shopkeeper
  // has just raised the threshold on this phone and has not refetched.
  const stale = product({ id: 'a', stock: 8, low_stock_threshold: 20, stock_state: 'ok' })
  eq(stockState(stale), 'low', 'the badge follows the numbers on the row, not a stale column')
}

suite('isExpiring')
{
  ok(isExpiring(product({ id: 'a', days_to_expiry: 30 })), 'thirty days out is the edge of the window')
  notOk(isExpiring(product({ id: 'a', days_to_expiry: 31 })), 'thirty-one is outside it')
  ok(isExpiring(product({ id: 'a', days_to_expiry: -3 })), 'already expired needs attention most')
  notOk(isExpiring(product({ id: 'a', days_to_expiry: -3, stock: 0 })), 'unless the shelf is empty anyway')
  notOk(isExpiring(product({ id: 'a', days_to_expiry: null })), 'rice has no expiry date and is not a problem')
}

/* ── Filtering the list ─────────────────────────────────────────────────────── */

const retired = product({ id: 'p-old', name: 'Cassette', name_bn: 'ক্যাসেট', is_active: false, stock: 0 })
const lowTea = product({ id: 'p-tea2', name: 'Tea Small', name_bn: 'চা ছোট', stock: 3 })
const dated = product({ id: 'p-milk', name: 'Milk', name_bn: 'দুধ', days_to_expiry: 4 })
const stack = [tea, soap, lowTea, dated, retired]

suite('filterCatalog')
{
  const ids = (tab: CatalogTab) => filterCatalog(stack, tab).map((row) => row.id)

  deepEq(ids('all'), ['p-tea', 'p-soap', 'p-tea2', 'p-milk'], 'everything still sold, in the order given')
  deepEq(ids('low'), ['p-soap', 'p-tea2'], 'running low includes what has run out — it is one shopping list')
  deepEq(ids('out'), ['p-soap'], 'out of stock is the narrower question')
  deepEq(ids('expiring'), ['p-milk'], 'and expiring is its own')
  deepEq(ids('inactive'), ['p-old'], 'the retired ones are only ever in their own tab')
}

suite('catalogCounts')
{
  const counts = catalogCounts(stack)
  eq(counts.all, 4, 'the retired product is not counted among the live ones')
  eq(counts.low, 2, 'low counts the empty shelf too, matching the tab')
  eq(counts.out, 1, 'out is a subset of low')
  eq(counts.expiring, 1, 'one dated packet')
  eq(counts.inactive, 1, 'and one retired line')

  for (const tab of ['all', 'low', 'out', 'expiring', 'inactive'] as CatalogTab[]) {
    eq(counts[tab], filterCatalog(stack, tab).length, `the ${tab} badge matches the ${tab} list`)
  }

  const empty = catalogCounts([])
  eq(empty.all, 0, 'a new shop counts zero')
  eq(empty.inactive, 0, 'in every tab')
}

suite('browseCatalog')
{
  const browsed = browseCatalog(stack, 'all', '').map((row) => row.id)
  deepEq(browsed, ['p-tea', 'p-tea2', 'p-milk', 'p-soap'], 'no query means alphabetical, so the list holds still')

  const searched = browseCatalog(stack, 'all', 'চা').map((row) => row.id)
  deepEq(searched, ['p-tea', 'p-tea2'], 'a query means relevance, and narrows to the matches')

  deepEq(browseCatalog(stack, 'low', 'চা').map((row) => row.id), ['p-tea2'], 'the tab still applies')
  deepEq(browseCatalog(stack, 'low', 'দুধ'), [], 'a match outside the tab is not shown')
  deepEq(browseCatalog(stack, 'all', '   ').map((row) => row.id), browsed, 'whitespace is not a query')
}
