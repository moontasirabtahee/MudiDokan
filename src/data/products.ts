import type {
  Category,
  ExpiringRow,
  LowStockRow,
  Product,
  ProductStatus,
  StockLedgerEntry,
  UnitType,
} from '@/lib/database.types'
import { LIMITS } from '@/lib/constants'
import { supabase, unwrap } from '@/lib/supabase'

/**
 * Product and stock reads.
 *
 * Everything here selects from `v_products_status` rather than `products`, because
 * every screen that shows a product also shows something the view computes —
 * margin, stock state, days to expiry. Reading the table and recomputing those in
 * TypeScript would give this app two definitions of "low stock", and the one on
 * screen would be the wrong one.
 *
 * The lists are fetched whole and filtered in the browser. That is not laziness
 * about pagination: a neighbourhood shop carries a few hundred lines, the whole set
 * is a couple of hundred kilobytes, and it has to be searchable with the tower
 * down. A server-side `ilike` search would work beautifully in the city and not at
 * all in the village this is for.
 */

export async function listProducts(shopId: string): Promise<ProductStatus[]> {
  return unwrap(
    supabase
      .from('v_products_status')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('name')
      .limit(LIMITS.catalogMax),
  )
}

/** Includes the retired ones, for the settings-side list where they can be brought back. */
export async function listAllProducts(shopId: string): Promise<ProductStatus[]> {
  return unwrap(
    supabase
      .from('v_products_status')
      .select('*')
      .eq('shop_id', shopId)
      .order('name')
      .limit(LIMITS.catalogMax),
  )
}

export async function getProduct(productId: string): Promise<ProductStatus> {
  return unwrap(supabase.from('v_products_status').select('*').eq('id', productId).single())
}

export async function listLowStock(shopId: string): Promise<LowStockRow[]> {
  // No `order` clause, on purpose. Urgency here is "how much of the buffer is left",
  // which compares a fraction rather than a column, and the order has to change the
  // moment a shopkeeper corrects a stock figure on this device. `reorder.ts` sorts it.
  return unwrap(supabase.from('v_low_stock').select('*').eq('shop_id', shopId))
}

export async function listExpiring(shopId: string): Promise<ExpiringRow[]> {
  return unwrap(supabase.from('v_expiring_soon').select('*').eq('shop_id', shopId))
}

export async function listCategories(shopId: string): Promise<Category[]> {
  return unwrap(
    supabase.from('categories').select('*').eq('shop_id', shopId).order('sort_order').order('name'),
  )
}

export async function listStockLedger(productId: string): Promise<StockLedgerEntry[]> {
  return unwrap(
    supabase
      .from('stock_ledger')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(LIMITS.ledgerPage),
  )
}

/* ── Writes that are not queueable ──────────────────────────────────────── */

/**
 * Creating and editing a product is a direct write, not an outbox operation.
 *
 * The queue can only carry operations whose result nobody is waiting for. A new
 * product is the opposite: the next thing the shopkeeper does is sell it, and that
 * needs its id. Queuing it would mean showing a product that might exist later and
 * cannot be sold now, which is worse than saying "this one needs a connection".
 */
export interface ProductDraft {
  name: string
  name_bn?: string | null
  category_id?: string | null
  sku?: string | null
  barcode?: string | null
  unit: UnitType
  is_weighted: boolean
  buy_price: number
  sell_price: number
  low_stock_threshold: number
  expiry_date?: string | null
  note?: string | null
  opening_stock?: number | null
}

import { invalidateCacheKey, invalidateCachePrefix } from '@/offline/db'
import { newId } from '@/lib/utils'

export async function createProduct(shopId: string, draft: ProductDraft): Promise<Product> {
  const result = await unwrap<Product>(
    supabase
      .from('products')
      .insert({
        shop_id: shopId,
        name: draft.name,
        name_bn: draft.name_bn ?? null,
        category_id: draft.category_id ?? null,
        sku: draft.sku ?? null,
        barcode: draft.barcode ?? null,
        unit: draft.unit,
        is_weighted: draft.is_weighted,
        buy_price: draft.buy_price,
        sell_price: draft.sell_price,
        low_stock_threshold: draft.low_stock_threshold,
        expiry_date: draft.expiry_date ?? null,
        image_url: null,
        note: draft.note ?? null,
        is_active: true,
      })
      .select('*')
      .single(),
  )

  if (draft.opening_stock && draft.opening_stock > 0) {
    try {
      await supabase.rpc('adjust_stock', {
        payload: {
          shop_id: shopId,
          product_id: result.id,
          delta: draft.opening_stock,
          reason: 'count',
          note: 'Opening stock',
          client_uuid: newId(),
        },
      })
    } catch (err) {
      console.warn('[mudidokan] could not set initial stock:', err)
    }
  }

  await invalidateCachePrefix(shopId, 'products:')
  await invalidateCachePrefix(shopId, 'product:')
  await invalidateCachePrefix(shopId, 'stock:')
  await invalidateCacheKey(shopId, 'dashboard:today')

  return result
}

export async function updateProduct(
  productId: string,
  patch: Partial<ProductDraft> & { is_active?: boolean },
): Promise<Product> {
  // `stock` is absent from `ProductDraft` on purpose: it is a trigger-maintained
  // cache over `stock_ledger`, and the only honest way to change it is
  // `adjust_stock`, which writes a ledger entry saying why.
  const result = await unwrap<Product>(
    supabase.from('products').update(patch).eq('id', productId).select('*').single(),
  )

  if (result.shop_id) {
    await invalidateCachePrefix(result.shop_id, 'products:')
    await invalidateCachePrefix(result.shop_id, 'product:')
    await invalidateCachePrefix(result.shop_id, 'stock:')
    await invalidateCacheKey(result.shop_id, 'dashboard:today')
  }

  return result
}

export async function createCategory(shopId: string, name: string): Promise<Category> {
  const result = await unwrap<Category>(
    supabase.from('categories').insert({ shop_id: shopId, name }).select('*').single(),
  )
  await invalidateCachePrefix(shopId, 'categories')
  return result
}

/**
 * Find a product by its barcode, for the scanner.
 *
 * `maybeSingle` rather than `single`: an unrecognised barcode is the common case in
 * a shop where half the stock is loose rice, and it is a question to the
 * shopkeeper ("add this one?"), not an error.
 */
export async function findByBarcode(shopId: string, barcode: string): Promise<ProductStatus | null> {
  return unwrap(
    supabase
      .from('v_products_status')
      .select('*')
      .eq('shop_id', shopId)
      .eq('barcode', barcode)
      .maybeSingle(),
  )
}
