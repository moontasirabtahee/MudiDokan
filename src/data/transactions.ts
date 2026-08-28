import type {
  Expense,
  Payment,
  Product,
  Purchase,
  PurchaseItem,
  Sale,
  SaleItem,
  Supplier,
} from '@/lib/database.types'
import { LIMITS } from '@/lib/constants'
import { addDays, isoDay } from '@/lib/format'
import { supabase, unwrap, unwrapAs } from '@/lib/supabase'

/**
 * Transaction reads: sales, purchases, payments, expenses.
 *
 * All of these are history. Nothing here writes — every transaction in this app is
 * created by an RPC through the outbox, because every one of them moves stock or a
 * balance and those movements have to happen in one transaction with the row that
 * caused them.
 *
 * ## Why the day filters look like this
 *
 * A "day" in this app is the shop's business day in the shop's own timezone, and
 * these columns are `timestamptz`. A PostgREST filter like
 * `gte('sold_at', '2026-08-26T00:00:00')` sends a timestamp with no zone, which
 * Postgres resolves against the *server's* zone — UTC on Supabase. In Dhaka that
 * puts a sale rung up at half past midnight into yesterday's takings.
 *
 * So the filter is deliberately loose — a day either side, which is more than any
 * offset on earth — and the exact boundary is applied here, with the same `isoDay`
 * the rest of the app uses. One definition of "today", in one place, for a cost of a
 * few dozen extra rows.
 */

const SLACK_DAYS = 1

export interface SaleWithItems extends Sale {
  items: SaleItem[]
}

export async function listSalesForDay(
  shopId: string,
  day: string,
  timeZone: string,
): Promise<Sale[]> {
  const rows = await unwrap(
    supabase
      .from('sales')
      .select('*')
      .eq('shop_id', shopId)
      .gte('sold_at', addDays(day, -SLACK_DAYS))
      .lte('sold_at', `${addDays(day, SLACK_DAYS)}T23:59:59`)
      .order('sold_at', { ascending: false })
      .limit(LIMITS.ledgerPage * 3),
  )
  return rows.filter((row) => isoDay(row.sold_at, timeZone) === day)
}

export async function listRecentSales(shopId: string, limit = 20): Promise<Sale[]> {
  return unwrap(
    supabase
      .from('sales')
      .select('*')
      .eq('shop_id', shopId)
      .order('sold_at', { ascending: false })
      .limit(limit),
  )
}

export async function getSale(saleId: string): Promise<SaleWithItems> {
  // One round trip for the receipt: the sale and its lines. The shape below is the
  // guarantee behind `unwrapAs` — `items` is the embedded `sale_items` rows.
  return unwrapAs<SaleWithItems>(
    supabase.from('sales').select('*, items:sale_items(*)').eq('id', saleId).single(),
  )
}

export async function listSalesForCustomer(customerId: string, limit = 20): Promise<Sale[]> {
  return unwrap(
    supabase
      .from('sales')
      .select('*')
      .eq('customer_id', customerId)
      .order('sold_at', { ascending: false })
      .limit(limit),
  )
}

export interface PurchaseItemWithProduct extends PurchaseItem {
  product?: Pick<Product, 'id' | 'name' | 'name_bn'> | null
}

export interface PurchaseWithItems extends Purchase {
  items: PurchaseItemWithProduct[]
  supplier: Pick<Supplier, 'id' | 'name' | 'company'> | null
}

export async function listPurchases(shopId: string, limit = LIMITS.pageSize): Promise<Purchase[]> {
  return unwrap(
    supabase
      .from('purchases')
      .select('*')
      .eq('shop_id', shopId)
      .order('purchased_at', { ascending: false })
      .limit(limit),
  )
}

export async function getPurchase(purchaseId: string): Promise<PurchaseWithItems> {
  return unwrapAs<PurchaseWithItems>(
    supabase
      .from('purchases')
      .select('*, items:purchase_items(*, product:products(id, name, name_bn)), supplier:suppliers(id, name, company)')
      .eq('id', purchaseId)
      .single(),
  )
}

/* ── Payments ───────────────────────────────────────────────────────────── */

export async function listPaymentsForDay(
  shopId: string,
  day: string,
  timeZone: string,
): Promise<Payment[]> {
  const rows = await unwrap(
    supabase
      .from('payments')
      .select('*')
      .eq('shop_id', shopId)
      .gte('paid_at', addDays(day, -SLACK_DAYS))
      .lte('paid_at', `${addDays(day, SLACK_DAYS)}T23:59:59`)
      .order('paid_at', { ascending: false })
      .limit(LIMITS.ledgerPage),
  )
  return rows.filter((row) => isoDay(row.paid_at, timeZone) === day)
}

/* ── Expenses ───────────────────────────────────────────────────────────── */

export async function listExpenses(
  shopId: string,
  fromDay: string,
  toDay: string,
  timeZone: string,
): Promise<Expense[]> {
  const rows = await unwrap(
    supabase
      .from('expenses')
      .select('*')
      .eq('shop_id', shopId)
      .gte('spent_at', addDays(fromDay, -SLACK_DAYS))
      .lte('spent_at', `${addDays(toDay, SLACK_DAYS)}T23:59:59`)
      .order('spent_at', { ascending: false })
      .limit(LIMITS.ledgerPage),
  )
  return rows.filter((row) => {
    const day = isoDay(row.spent_at, timeZone)
    return day >= fromDay && day <= toDay
  })
}
