import type { StringKey } from '@/i18n/strings'
import type { AdjustStockPayload, StockReason } from '@/lib/database.types'
import { roundTo } from '@/lib/format'

/**
 * Correcting the stock, in the two ways a shopkeeper actually arrives at it.
 *
 * He either counted the shelf and got a different number, or something specific
 * happened to specific packets. Those are not the same thought, and a single "enter the
 * change" box serves neither: the first requires him to do subtraction he did not ask
 * for, and the second requires him to remember the sign.
 *
 * So: two modes. "I counted" takes the number he is holding in his head and works out
 * the difference. "Something was lost" takes a count of packets and a reason, and is
 * always a subtraction. Both end as one signed `delta` and a reason, which is all the
 * ledger has ever wanted.
 */

export type AdjustMode = 'count' | 'remove'

export interface AdjustState {
  mode: AdjustMode
  /** Only meaningful in 'remove' mode — a count is always a correction. */
  reason: StockReason
  /** 'count' mode: what is on the shelf. */
  counted: number | null
  /** 'remove' mode: how much went. Always positive; the sign is this file's job. */
  amount: number | null
  note: string
}

export function emptyAdjust(mode: AdjustMode = 'count'): AdjustState {
  return { mode, reason: 'damage', counted: null, amount: null, note: '' }
}

/**
 * The signed change, rounded to three places.
 *
 * Three because a weighed product can legitimately be 2.5 kg, and because that is what
 * `cartReducer` uses for quantities — one rounding rule for quantities across the app,
 * so a stock number never disagrees with itself by a gram.
 */
export function deltaOf(state: AdjustState, current: number): number {
  if (state.mode === 'count') {
    if (state.counted === null) return 0
    return roundTo(state.counted - current, 3)
  }
  if (state.amount === null) return 0
  return roundTo(-Math.abs(state.amount), 3)
}

export function balanceAfter(state: AdjustState, current: number): number {
  return roundTo(current + deltaOf(state, current), 3)
}

/** A count is a correction, whatever the reason picker happens to be showing. */
export function reasonOf(state: AdjustState): StockReason {
  return state.mode === 'count' ? 'correction' : state.reason
}

export interface AdjustCheck {
  ok: boolean
  error: StringKey | null
  advisories: StringKey[]
}

/**
 * What stops the save: nothing to record, or a number that cannot be read.
 *
 * Stock going below zero does *not* stop it. That happens for a real reason — sales
 * were rung up before the opening stock was entered, or a purchase never got recorded
 * — and refusing the correction would leave the shopkeeper with a number he knows is
 * wrong and no way to fix it. He is told, and then he decides.
 */
export function checkAdjust(state: AdjustState, current: number): AdjustCheck {
  const advisories: StringKey[] = []

  if (state.mode === 'count') {
    if (state.counted === null) return { ok: false, error: 'stock.needCount', advisories }
    if (state.counted < 0) return { ok: false, error: 'error.invalidAmount', advisories }
    if (deltaOf(state, current) === 0) return { ok: false, error: 'stock.noChange', advisories }
  } else {
    if (state.amount === null || state.amount === 0) {
      return { ok: false, error: 'stock.needAmount', advisories }
    }
    if (state.amount < 0) return { ok: false, error: 'error.invalidAmount', advisories }
  }

  if (balanceAfter(state, current) < 0) advisories.push('stock.willGoNegative')

  return { ok: true, error: null, advisories }
}

export function toAdjustPayload(
  state: AdjustState,
  context: { shopId: string; productId: string; current: number; clientUuid: string },
): AdjustStockPayload {
  return {
    shop_id: context.shopId,
    client_uuid: context.clientUuid,
    product_id: context.productId,
    delta: deltaOf(state, context.current),
    reason: reasonOf(state),
    note: state.note.trim() || null,
  }
}
