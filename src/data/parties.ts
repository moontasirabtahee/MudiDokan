import type {
  Customer,
  CustomerDue,
  PartyLedgerEntry,
  Supplier,
  SupplierDue,
} from '@/lib/database.types'
import { LIMITS } from '@/lib/constants'
import { supabase, unwrap } from '@/lib/supabase'

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
  )
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
  )
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
  return unwrap(
    supabase
      .from('party_ledger')
      .select('*')
      .eq(column, partyId)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMITS.ledgerPage),
  )
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
