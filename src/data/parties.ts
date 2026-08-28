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

export async function listCustomerDues(shopId: string): Promise<CustomerDue[]> {
  // Everyone, not only the debtors: this list doubles as the customer directory,
  // and a shopkeeper looking up a phone number should not have to remember whether
  // that person happens to owe anything today.
  return unwrap(
    supabase
      .from('v_customer_dues')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('due_balance', { ascending: false })
      .order('name')
      .limit(LIMITS.catalogMax),
  ).catch(() => [] as CustomerDue[])
}

export async function getCustomerDue(customerId: string): Promise<CustomerDue> {
  return unwrap(supabase.from('v_customer_dues').select('*').eq('id', customerId).single())
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

    pendingEntries = matching.map((r) => {
      const payload = (r.args as { payload?: Record<string, unknown> })?.payload || {}
      let entryType: PartyLedgerEntry['entry_type'] = 'payment'
      let amount = Number(payload.amount ?? r.amount ?? 0)
      if (r.op === 'create_sale') {
        entryType = 'sale'
        amount = Number(payload.total ?? r.amount ?? 0)
      } else if (r.op === 'set_opening_balance') {
        entryType = (payload.entry_type as PartyLedgerEntry['entry_type']) || 'opening_balance'
      }

      return {
        id: r.id,
        shop_id: r.shopId,
        customer_id: party === 'customer' ? partyId : null,
        supplier_id: party === 'supplier' ? partyId : null,
        entry_type: entryType,
        amount,
        balance_after: 0,
        ref_id: null,
        note: (payload.note as string) || null,
        occurred_at: (payload.occurred_at || payload.paid_at || payload.sold_at || r.createdAt) as string,
        created_at: r.createdAt,
        client_uuid: (payload.client_uuid as string) || r.id,
      } as PartyLedgerEntry
    })
  } catch {
    // Ignore outbox read failures
  }

  const existingUuids = new Set(rows.map((r) => r.client_uuid).filter(Boolean))
  const uniquePending = pendingEntries.filter((p) => !existingUuids.has(p.client_uuid))

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
