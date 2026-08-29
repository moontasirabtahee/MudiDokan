import { useCallback, useRef, useState } from 'react'
import type { StringKey } from '@/i18n/strings'
import type { MemberRole } from '@/lib/database.types'
import { AppError } from '@/lib/supabase'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import { useSyncState } from './useSync'
import { sync } from '@/offline/sync'

/**
 * The writes that cannot be queued.
 *
 * `useWrite` is for the seven operations in the outbox — the ones where "the phone
 * has it" is as good as "the server has it", because nobody is waiting for the
 * answer. This hook is for the rest: creating a product, adding a customer, changing
 * the shop's name, inviting a cashier. Every one of them produces an id or a state the
 * shopkeeper's *next* action depends on, and a queued row that might exist later and
 * cannot be used now is worse than a plain "this needs a connection".
 *
 * So the honest thing is to say no early. Offline is checked before the request rather
 * than after a thirty-second timeout, because a shopkeeper who taps "save" and watches
 * a spinner has been told nothing.
 *
 * Same contract as `useWrite`, deliberately: branch on `ok`, and read `result` only
 * inside that branch.
 *
 *   const save = useAction((draft: ProductDraft) => createProduct(shopId, draft), {
 *     role: 'manager',
 *     success: 'common.saved',
 *   })
 *   const out = await save.run(draft)
 *   if (out.ok) navigate(ROUTES.products)
 */

export interface ActionOutcome<T> {
  ok: boolean
  result: T | null
  error: unknown
}

export interface ActionApi<A extends unknown[], T> {
  run: (...args: A) => Promise<ActionOutcome<T>>
  /** In flight. Feed it to a button's `loading`. */
  busy: boolean
  /** False when this member's role or this subscription cannot do it. */
  allowed: boolean
}

export interface ActionOptions {
  /** Minimum role. Defaults to manager, which is right for everything but a sale. */
  role?: MemberRole
  /** Toast on success. Null for a screen that shows its own confirmation. */
  success?: StringKey | null
}

const REFUSED: ActionOutcome<never> = { ok: false, result: null, error: null }

export function useAction<A extends unknown[], T>(
  perform: (...args: A) => Promise<T>,
  options: ActionOptions = {},
): ActionApi<A, T> {
  const { role = 'manager', success = 'common.saved' } = options
  const toast = useToast()
  const { may } = useShop()
  const { online } = useSyncState()
  const [busy, setBusy] = useState(false)

  // A ref as well as state: `setBusy` does not apply until the next render, and a
  // double tap arrives inside the same one. Two products named the same thing is a
  // mess someone has to clean up by hand.
  const inFlight = useRef(false)

  // `perform` closes over the form's current values, so it is a fresh arrow on every
  // render. Through a ref it cannot make `run` unstable.
  const performRef = useRef(perform)
  performRef.current = perform

  const allowed = may(role)

  const run = useCallback(
    async (...args: A): Promise<ActionOutcome<T>> => {
      if (inFlight.current) return REFUSED
      if (!allowed) {
        const error = new AppError('permission', 'error.permission')
        toast.fail(error)
        return { ...REFUSED, error }
      }
      if (!online) {
        const error = new AppError('offline', 'error.network')
        toast.fail(error)
        return { ...REFUSED, error }
      }

      inFlight.current = true
      setBusy(true)
      try {
        const result = await performRef.current(...args)
        if (success) toast.say(success, undefined, { kind: 'success' })
        sync.notifyMutation()
        return { ok: true, result, error: null }
      } catch (error) {
        toast.fail(error)
        return { ok: false, result: null, error }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [allowed, online, success, toast],
  )

  return { run, busy, allowed }
}
