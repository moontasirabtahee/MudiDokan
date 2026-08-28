import type {
  Customer,
  CustomerDue,
  PartyLedgerEntry,
  Supplier,
  SupplierDue,
} from '@/lib/database.types'
import { LIMITS } from '@/lib/constants'
import { supabase, unwrap } from '@/lib/supabase'
import { listOutbox } from '@/offline/outbox'

/**
 * The khata: customers who owe, suppliers who are owed, and the entries behind
 * both balances.
 *
 * `due_balance` on the customer row is a trigger-maintained cache over
 * `party_ledger`, and nothing here ever writes it. That is the single most
 * important property of this module: a paper khata goes wrong because two people
 * add up the same column differently, and the fix is not a better calculator but
 * one place where the number comes from. Here that place is the database.
 *
 * Reads come from `v_customer_dues`, which adds the parts a shopkeeper actually
 * chases with: when they last paid, how old the debt is, whether they are over
 * their limit.
 */

/** Calculates pending outbox debt adjustments for customers */
async function getPendingCustomerDeltas(shopId?: string): Promise<Map<string, number>> {
  const deltas = new Map<string, number>()
  try {
    const outboxRecords = await listOutbox(shopId ? { shopId } : undefined)
    for (const r of outboxRecords) {
      if (r.status === 'failed') continue
      const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
      if (r.op === 'create_sale' && payload.customer_id) {
        const custId = String(payload.customer_id)
        const items = (payload.items as Array<{ qty: number; unit_price: number; line_discount?: number }>) || []
        let gross = 0
        for (const it of items) {
          gross += (it.qty * it.unit_price) - (it.line_discount || 0)
        }
        const total = Math.max(0, gross - Number(payload.discount || 0))
        const paid = Number(payload.paid ?? total)
        const due = Math.max(0, total - paid)
        if (due > 0) {
          deltas.set(custId, (deltas.get(custId) || 0) + due)
        }
      } else if (r.op === 'record_payment' && payload.customer_id) {
        const custId = String(payload.customer_id)
        const amount = Number(payload.amount || 0)
        deltas.set(custId, (deltas.get(custId) || 0) - amount)
      } else if (r.op === 'set_opening_balance' && payload.customer_id) {
        const custId = String(payload.customer_id)
        const amount = Number(payload.amount || 0)
        deltas.set(custId, (deltas.get(custId) || 0) + amount)
      }
    }
  } catch {
    // Ignore outbox read failures
  }
  return deltas
}

export async function listCustomerDues(shopId: string): Promise<CustomerDue[]> {
  const rows = await unwrap(
    supabase
      .from('v_customer_dues')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('due_balance', { ascending: false })
      .order('name')
      .limit(LIMITS.catalogMax),
  ).catch(() => [] as CustomerDue[])

  const deltas = await getPendingCustomerDeltas(shopId)
  if (deltas.size === 0) return rows

  return rows.map((row) => {
    const delta = deltas.get(row.id)
    if (!delta) return row
    const newBal = Math.max(0, row.due_balance + delta)
    return {
      ...row,
      due_balance: newBal,
      over_limit: row.credit_limit > 0 && newBal > row.credit_limit,
    }
  })
}

export async function getCustomerDue(customerId: string): Promise<CustomerDue> {
  const row = await unwrap<CustomerDue>(supabase.from('v_customer_dues').select('*').eq('id', customerId).single())
  const deltas = await getPendingCustomerDeltas()
  const delta = deltas.get(customerId)
  if (!delta) return row
  const newBal = Math.max(0, row.due_balance + delta)
  return {
    ...row,
    due_balance: newBal,
    over_limit: row.credit_limit > 0 && newBal > row.credit_limit,
  }
}

export async function listSupplierDues(shopId: string): Promise<SupplierDue[]> {
  return unwrap(
    supabase
      .from('v_supplier_dues')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('due_balance', { ascending: false })
      .order('name')
      .limit(LIMITS.catalogMax),
  ).catch(() => [] as SupplierDue[])
}

export async function getSupplierDue(supplierId: string): Promise<SupplierDue> {
  return unwrap(supabase.from('v_supplier_dues').select('*').eq('id', supplierId).single())
}

/**
 * One party's statement.
 *
 * `occurred_at` rather than `created_at`, because an opening balance recorded today
 * for a debt from last month belongs where the shopkeeper says it belongs. The
 * `balance_after` column is what makes this a statement rather than a list: it was
 * computed in order, by the trigger, at the moment each entry landed.
 */
export async function listPartyLedger(
  party: 'customer' | 'supplier',
  partyId: string,
): Promise<PartyLedgerEntry[]> {
  const column = party === 'customer' ? 'customer_id' : 'supplier_id'
  const rows = await unwrap(
    supabase
      .from('party_ledger')
      .select('*')
      .eq(column, partyId)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMITS.ledgerPage),
  ).catch(() => [] as PartyLedgerEntry[])

  let pendingEntries: PartyLedgerEntry[] = []
  try {
    const outboxRecords = await listOutbox()
    const matching = outboxRecords.filter((r) => {
      if (r.status === 'failed') return false
      const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
      if (r.op === 'record_payment') {
        return party === 'customer' ? payload.customer_id === partyId : payload.supplier_id === partyId
      }
      if (r.op === 'set_opening_balance') {
        return party === 'customer' ? payload.customer_id === partyId : payload.supplier_id === partyId
      }
      if (r.op === 'create_sale' && party === 'customer') {
        return payload.customer_id === partyId
      }
      return false
    })

    for (const r of matching) {
      const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
      let entryType: PartyLedgerEntry['entry_type'] = party === 'customer' ? 'payment_received' : 'payment_made'
      let amount = Number(payload.amount ?? r.amount ?? 0)

      if (r.op === 'create_sale') {
        entryType = 'credit_sale'
        const items = (payload.items as Array<{ qty: number; unit_price: number; line_discount?: number }>) || []
        let gross = 0
        for (const it of items) {
          gross += (it.qty * it.unit_price) - (it.line_discount || 0)
        }
        const total = Math.max(0, gross - Number(payload.discount || 0))
        const paid = Number(payload.paid ?? total)
        amount = Math.max(0, total - paid)
        // If there was no due on this sale, it does not create a party ledger entry
        if (amount <= 0) continue
      } else if (r.op === 'set_opening_balance') {
        entryType = (payload.entry_type as PartyLedgerEntry['entry_type']) || 'opening_balance'
      }

      pendingEntries.push({
        id: r.id,
        shop_id: r.shopId,
        party,
        customer_id: party === 'customer' ? partyId : null,
        supplier_id: party === 'supplier' ? partyId : null,
        entry_type: entryType,
        amount,
        ref_table: null,
        ref_id: null,
        balance_after: rows[0]?.balance_after ?? 0,
        note: (payload.note as string) || null,
        occurred_at: (payload.occurred_at || payload.paid_at || payload.sold_at || r.createdAt) as string,
        created_by: null,
        created_at: r.createdAt,
      })
    }
  } catch {
    // Ignore outbox read failures
  }

  const existingIds = new Set(rows.map((r) => r.id))
  const uniquePending = pendingEntries.filter((p) => !existingIds.has(p.id))

  return [...uniquePending, ...rows]
}

/* ── Writes that are not queueable ──────────────────────────────────────── */

export interface CustomerDraft {
  name: string
  phone?: string | null
  address?: string | null
  /** 0 means no limit, which is what a shopkeeper who has never thought about it wants. */
  credit_limit?: number
  note?: string | null
}

/**
 * A new customer needs a connection, and the sheet that calls this says so.
 *
 * The id has to come from the database — the next thing that happens is a credit
 * sale against it, and `create_sale` needs a `customer_id` that exists. A queued
 * customer would produce a queued sale pointing at a row that may never be created,
 * which is a corrupted khata rather than a delayed one.
 *
 * The honest fallback, offered in the UI, is to ring the sale up as cash and add the
 * customer later. Adding a customer happens once per person; selling to them
 * happens every day, and that path never needs a network.
 */
export async function createCustomer(shopId: string, draft: CustomerDraft): Promise<Customer> {
  return unwrap(
    supabase
      .from('customers')
      .insert({
        shop_id: shopId,
        name: draft.name,
        phone: draft.phone ?? null,
        address: draft.address ?? null,
        credit_limit: draft.credit_limit ?? 0,
        note: draft.note ?? null,
        is_active: true,
      })
      .select('*')
      .single(),
  )
}

export async function updateCustomer(
  customerId: string,
  patch: Partial<CustomerDraft> & { is_active?: boolean },
): Promise<Customer> {
  return unwrap(supabase.from('customers').update(patch).eq('id', customerId).select('*').single())
}

export interface SupplierDraft {
  name: string
  company?: string | null
  phone?: string | null
  address?: string | null
  note?: string | null
}

export async function createSupplier(shopId: string, draft: SupplierDraft): Promise<Supplier> {
  return unwrap(
    supabase
      .from('suppliers')
      .insert({
        shop_id: shopId,
        name: draft.name,
        company: draft.company ?? null,
        phone: draft.phone ?? null,
        address: draft.address ?? null,
        note: draft.note ?? null,
        is_active: true,
      })
      .select('*')
      .single(),
  )
}

export async function updateSupplier(
  supplierId: string,
  patch: Partial<SupplierDraft> & { is_active?: boolean },
): Promise<Supplier> {
  return unwrap(supabase.from('suppliers').update(patch).eq('id', supplierId).select('*').single())
}
