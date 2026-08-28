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
import { listOutbox } from '@/offline/outbox'

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
  ).catch(() => [] as Sale[])

  let pendingSales: Sale[] = []
  try {
    const outboxRecords = await listOutbox({ shopId })
    pendingSales = outboxRecords
      .filter((r) => r.op === 'create_sale' && r.status !== 'failed')
      .map((r) => {
        const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
        const total = Number(payload.total ?? r.amount ?? 0)
        const discount = Number(payload.discount ?? 0)
        return {
          id: r.id,
          shop_id: r.shopId,
          invoice_no: null,
          customer_id: (payload.customer_id as string) || null,
          subtotal: total + discount,
          discount,
          total,
          paid: Number(payload.paid ?? total),
          change_due: 0,
          payment_method: (payload.payment_method as Sale['payment_method']) || 'cash',
          note: (payload.note as string) || null,
          sold_at: (payload.sold_at as string) || r.createdAt,
          created_by: null,
          created_at: r.createdAt,
          is_void: false,
          client_uuid: (payload.client_uuid as string) || r.id,
        } as Sale
      })
  } catch {
    // Ignore outbox read failures
  }

  const existingUuids = new Set(rows.map((r) => r.client_uuid).filter(Boolean))
  const uniquePending = pendingSales.filter((p) => !existingUuids.has(p.client_uuid))

  const all = [...uniquePending, ...rows]
  return all.filter((row) => isoDay(row.sold_at, timeZone) === day)
}

export async function listRecentSales(shopId: string, limit = 20): Promise<Sale[]> {
  const rows = await unwrap(
    supabase
      .from('sales')
      .select('*')
      .eq('shop_id', shopId)
      .order('sold_at', { ascending: false })
      .limit(limit),
  ).catch(() => [] as Sale[])

  let pendingSales: Sale[] = []
  try {
    const outboxRecords = await listOutbox({ shopId })
    pendingSales = outboxRecords
      .filter((r) => r.op === 'create_sale' && r.status !== 'failed')
      .map((r) => {
        const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
        const total = Number(payload.total ?? r.amount ?? 0)
        const discount = Number(payload.discount ?? 0)
        return {
          id: r.id,
          shop_id: r.shopId,
          invoice_no: null,
          customer_id: (payload.customer_id as string) || null,
          subtotal: total + discount,
          discount,
          total,
          paid: Number(payload.paid ?? total),
          change_due: 0,
          payment_method: (payload.payment_method as Sale['payment_method']) || 'cash',
          note: (payload.note as string) || null,
          sold_at: (payload.sold_at as string) || r.createdAt,
          created_by: null,
          created_at: r.createdAt,
          is_void: false,
          client_uuid: (payload.client_uuid as string) || r.id,
        } as Sale
      })
  } catch {
    // Ignore outbox read failures
  }

  const existingUuids = new Set(rows.map((r) => r.client_uuid).filter(Boolean))
  const uniquePending = pendingSales.filter((p) => !existingUuids.has(p.client_uuid))

  return [...uniquePending, ...rows].slice(0, limit)
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
  ).catch(() => [] as Sale[])
}

export interface PurchaseItemWithProduct extends PurchaseItem {
  product?: Pick<Product, 'id' | 'name' | 'name_bn'> | null
}

export interface PurchaseWithItems extends Purchase {
  items: PurchaseItemWithProduct[]
  supplier: Pick<Supplier, 'id' | 'name' | 'company'> | null
}

export async function listPurchases(shopId: string, limit = LIMITS.pageSize): Promise<Purchase[]> {
  const rows = await unwrap(
    supabase
      .from('purchases')
      .select('*')
      .eq('shop_id', shopId)
      .order('purchased_at', { ascending: false })
      .limit(limit),
  ).catch(() => [] as Purchase[])

  let pendingPurchases: Purchase[] = []
  try {
    const outboxRecords = await listOutbox({ shopId })
    pendingPurchases = outboxRecords
      .filter((r) => r.op === 'create_purchase' && r.status !== 'failed')
      .map((r) => {
        const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
        const total = Number(payload.total ?? r.amount ?? 0)
        const discount = Number(payload.discount ?? 0)
        return {
          id: r.id,
          shop_id: r.shopId,
          supplier_id: (payload.supplier_id as string) || null,
          supplier_ref: (payload.supplier_ref as string) || null,
          subtotal: total + discount,
          discount,
          total,
          paid: Number(payload.paid ?? total),
          note: (payload.note as string) || null,
          purchased_at: (payload.purchased_at as string) || r.createdAt,
          created_by: null,
          created_at: r.createdAt,
          client_uuid: (payload.client_uuid as string) || r.id,
        } as Purchase
      })
  } catch {
    // Ignore outbox read failures
  }

  const existingUuids = new Set(rows.map((r) => r.client_uuid).filter(Boolean))
  const uniquePending = pendingPurchases.filter((p) => !existingUuids.has(p.client_uuid))

  return [...uniquePending, ...rows].slice(0, limit)
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
  ).catch(() => [] as Payment[])

  let pendingPayments: Payment[] = []
  try {
    const outboxRecords = await listOutbox({ shopId })
    pendingPayments = outboxRecords
      .filter((r) => r.op === 'record_payment' && r.status !== 'failed')
      .map((r) => {
        const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
        return {
          id: r.id,
          shop_id: r.shopId,
          party: (payload.party as Payment['party']) || 'customer',
          direction: (payload.direction as Payment['direction']) || 'in',
          customer_id: (payload.customer_id as string) || null,
          supplier_id: (payload.supplier_id as string) || null,
          amount: Number(payload.amount ?? r.amount ?? 0),
          method: (payload.method as Payment['method']) || 'cash',
          sale_id: (payload.sale_id as string) || null,
          purchase_id: (payload.purchase_id as string) || null,
          note: (payload.note as string) || null,
          paid_at: (payload.paid_at as string) || r.createdAt,
          created_by: null,
          created_at: r.createdAt,
          client_uuid: (payload.client_uuid as string) || r.id,
        } as Payment
      })
  } catch {
    // Ignore outbox read failures
  }

  const existingUuids = new Set(rows.map((r) => r.client_uuid).filter(Boolean))
  const uniquePending = pendingPayments.filter((p) => !existingUuids.has(p.client_uuid))

  const all = [...uniquePending, ...rows]
  return all.filter((row) => isoDay(row.paid_at, timeZone) === day)
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
  ).catch(() => [] as Expense[])

  let pendingExpenses: Expense[] = []
  try {
    const outboxRecords = await listOutbox({ shopId })
    pendingExpenses = outboxRecords
      .filter((r) => r.op === 'create_expense' && r.status !== 'failed')
      .map((r) => {
        const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
        return {
          id: r.id,
          shop_id: r.shopId,
          category: (payload.category as Expense['category']) || 'other',
          amount: Number(payload.amount ?? r.amount ?? 0),
          note: (payload.note as string) || null,
          spent_at: (payload.spent_at as string) || r.createdAt,
          created_by: null,
          created_at: r.createdAt,
          client_uuid: (payload.client_uuid as string) || r.id,
        } as Expense
      })
  } catch {
    // Ignore outbox read failures
  }

  const existingUuids = new Set(rows.map((r) => r.client_uuid).filter(Boolean))
  const uniquePending = pendingExpenses.filter((p) => !existingUuids.has(p.client_uuid))

  const all = [...uniquePending, ...rows]
  return all.filter((row) => {
    const day = isoDay(row.spent_at, timeZone)
    return day >= fromDay && day <= toDay
  })
}
