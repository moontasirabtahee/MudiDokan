import { useCallback, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import type { StringKey } from '@/i18n/strings'
import type { Database, MemberRole } from '@/lib/database.types'
import { AppError } from '@/lib/supabase'
import { type QueueableOp } from '@/offline/outbox'
import { submit } from '@/offline/submit'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'

type Fns = Database['public']['Functions']

/**
 * Writes, from a screen's point of view.
 *
 * `submit()` underneath handles the queue and the bounded wait. What this adds is
 * everything a screen would otherwise have to remember on every button: the shop
 * id, whether the subscription still allows writing, whether this member's role
 * reaches this operation, a label for the pending list, and which toast to show for
 * each of the three outcomes.
 *
 * The point is that those are decided once, here, rather than twenty-odd times
 * across the feature screens. A subscription check that exists on nineteen buttons
 * is a subscription check that is missing from the twentieth.
 *
 * The contract for callers is one line: branch on `ok`, never on `result`.
 *
 *   const { write, busy } = useWrite('record_payment')
 *   const out = await write({ args: { payload }, amount: taka })
 *   if (out.ok) navigate(ROUTES.khata)
 *
 * `ok` means the shopkeeper's intent is safe — either the server has it or the
 * phone does, and in a shop those are the same fact. `result` is the server's
 * answer and is null whenever `queued` is true, which is why a screen that needs
 * the new receipt number has to handle its absence rather than await it.
 */

/**
 * The role each operation needs, mirroring the RLS policies and the role
 * assertions inside the RPCs.
 *
 * This is a courtesy, not a control: the database refuses these regardless, and
 * the reason to check here as well is that a cashier deserves to be told before he
 * builds a purchase order, not after it fails in a queue overnight.
 *
 * It lives in this file rather than in `constants.ts` on purpose — putting a
 * `Record<QueueableOp, …>` there would make `constants.ts` import from
 * `offline/outbox.ts`, which imports `constants.ts` for the retry schedule, and a
 * cycle in the module that everything imports is a bad afternoon.
 */
const WRITE_MIN_ROLE: Record<QueueableOp, MemberRole> = {
  create_sale: 'cashier',
  record_payment: 'cashier',
  create_purchase: 'manager',
  adjust_stock: 'manager',
  create_expense: 'manager',
  set_opening_balance: 'manager',
  void_sale: 'manager',
}

/** The noun an unsent record goes by in the pending list. */
const QUEUE_LABEL: Record<QueueableOp, StringKey> = {
  create_sale: 'queue.create_sale',
  create_purchase: 'queue.create_purchase',
  record_payment: 'queue.record_payment',
  adjust_stock: 'queue.adjust_stock',
  create_expense: 'queue.create_expense',
  set_opening_balance: 'queue.set_opening_balance',
  void_sale: 'queue.void_sale',
}

export interface WriteInput<K extends QueueableOp> {
  /** The RPC's arguments verbatim — `{ payload }` for everything but `void_sale`. */
  args: Fns[K]['Args']
  /** Money involved, so the pending list can total itself. */
  amount?: number | null
  /** Overrides the default 'বিক্রি — ৳৫৫০'. */
  label?: string
  /** Toast on a confirmed server write. Null for a screen with its own confirmation. */
  success?: StringKey | null
  /** Toast when it stayed on the phone. Null to stay quiet. */
  queued?: StringKey | null
}

export interface WriteOutcome<T> {
  /** Sent or queued — the shopkeeper's work is safe. The only flag worth branching on. */
  ok: boolean
  /** Still on the phone. `result` is null and nothing may wait for it. */
  queued: boolean
  result: T | null
  error: unknown
}

const REFUSED: WriteOutcome<never> = { ok: false, queued: false, result: null, error: null }

/**
 * Three-way precedence where `null` is a real choice.
 *
 * `??` cannot be used for this: a screen that passes `success: null` to mean "I
 * show my own confirmation, stay quiet" would fall straight through to the default
 * toast and get exactly what it asked not to have. Only `undefined` means
 * "unspecified".
 */
function pick<V>(own: V | undefined, fallback: V | undefined, last: V): V {
  if (own !== undefined) return own
  if (fallback !== undefined) return fallback
  return last
}

export interface WriteApi<K extends QueueableOp, T> {
  write: (input: WriteInput<K>) => Promise<WriteOutcome<T>>
  /** A write is in flight. Feed it to a button's `loading`. */
  busy: boolean
  /** False when this member or this subscription cannot perform this operation. */
  allowed: boolean
}

export function useWrite<K extends QueueableOp, T = unknown>(
  op: K,
  defaults: Omit<WriteInput<K>, 'args'> = {},
): WriteApi<K, T> {
  const { t, money } = useI18n()
  const toast = useToast()
  const { shopId, canWrite, can } = useShop()
  const [busy, setBusy] = useState(false)

  // A ref as well as state, because `setBusy` does not take effect until the next
  // render and a double tap arrives inside the same one. The outbox would dedupe a
  // replay of the *same* client_uuid, but a screen that mints a fresh uuid per tap
  // would enqueue two real sales, and the money is the shopkeeper's.
  const inFlight = useRef(false)

  // `defaults` is an inline object at nearly every call site, so it changes identity
  // on every render. Through a ref it cannot make `write` unstable and re-render
  // every button that depends on it.
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  const minRole = WRITE_MIN_ROLE[op]
  const allowed = canWrite && can(minRole)

  const write = useCallback(
    async (input: WriteInput<K>): Promise<WriteOutcome<T>> => {
      if (inFlight.current) return REFUSED
      const fallbacks = defaultsRef.current
      if (!shopId) {
        // Only reachable from outside the shop guard, which is a wiring mistake
        // rather than anything a shopkeeper did.
        toast.say('error.generic')
        return REFUSED
      }

      // Both refusals happen before `enqueue`. Queuing a write the database is
      // certain to refuse would trade a clear "no" now for a failed record in the
      // outbox tonight, which is a worse version of the same answer.
      if (!canWrite) {
        const error = new AppError('billing', 'error.billing')
        toast.fail(error)
        return { ...REFUSED, error }
      }
      if (!can(minRole)) {
        const error = new AppError('permission', 'error.permission')
        toast.fail(error)
        return { ...REFUSED, error }
      }

      const amount = pick(input.amount, fallbacks.amount, null)
      const base = input.label ?? fallbacks.label ?? t(QUEUE_LABEL[op])
      const label = amount != null && amount > 0 ? `${base} — ${money(amount)}` : base

      inFlight.current = true
      setBusy(true)
      try {
        const outcome = await submit<K, T>({ op, args: input.args, shopId, label, amount })

        if (outcome.error) {
          // Terminal: a credit limit, a permission, a validation. The message came
          // from an assertion written for this exact moment, so it is shown as-is.
          toast.fail(outcome.error)
          return { ok: false, queued: false, result: null, error: outcome.error }
        }

        const key = outcome.queued
          ? pick<StringKey | null>(input.queued, fallbacks.queued, 'sync.queued')
          : pick<StringKey | null>(input.success, fallbacks.success, 'common.saved')
        if (key) toast.say(key, undefined, { kind: outcome.queued ? 'info' : 'success' })

        return { ok: true, queued: outcome.queued, result: outcome.result, error: null }
      } catch (error) {
        // `submit` only throws for a broken payload — a missing client_uuid — or a
        // dead IndexedDB. Both mean the write did not happen, so say so plainly
        // rather than letting a screen navigate away from work it did not save.
        toast.fail(error)
        return { ok: false, queued: false, result: null, error }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [op, shopId, canWrite, can, minRole, t, money, toast],
  )

  return { write, busy, allowed }
}
