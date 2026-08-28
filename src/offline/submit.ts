import { type EnqueueParams, type OutboxRecord, type QueueableOp, enqueue } from './outbox'
import { type SyncEngine, type SyncEvent, sync } from './sync'

/**
 * The single path every write in this application takes.
 *
 * Enqueue first, send second — always, online or not. The queue is not a fallback
 * for bad days; it is the write path, which is the only way an offline path stays
 * working. A feature exercised once a month is a feature that is broken.
 *
 * The wait is the interesting part. A write that lands in 300ms should tell the
 * shopkeeper it landed, and one that has not landed in a couple of seconds should
 * stop making him look at a spinner. So this waits a short, bounded moment for the
 * engine to report on *his* record and then answers honestly either way:
 *
 *   { queued: false, result }  — the server has it, here is what it said
 *   { queued: true }           — it is safe on the phone, it will go by itself
 *   { error }                   — it will never go, and here is why
 *
 * That third case is why this cannot be fire-and-forget. A credit sale that breaks
 * a customer's limit is refused by a `RAISE` in the RPC, and a shopkeeper needs to
 * hear that while the customer is still standing there — not tomorrow, from a
 * failed-queue badge.
 */

export interface SubmitResult<T> {
  record: OutboxRecord
  /** The server's answer, when it arrived within the wait. Null while queued. */
  result: T | null
  /** True when it is still in the queue. Nothing may depend on `result`. */
  queued: boolean
  /** Set only for a failure that will not be retried. */
  error: unknown
}

/** Long enough for a good connection to answer, short enough not to feel like one. */
const DEFAULT_WAIT_MS = 2200

export interface SubmitOptions {
  /** How long to wait for the server before answering "it is queued". */
  waitMs?: number
  /**
   * The engine to send through. The app has exactly one and never passes this;
   * it exists so the three outcomes above can be tested against a fake server
   * instead of a real tower.
   */
  engine?: SyncEngine
}

export async function submit<K extends QueueableOp, T = unknown>(
  params: EnqueueParams<K>,
  options: SubmitOptions = {},
): Promise<SubmitResult<T>> {
  const { waitMs = DEFAULT_WAIT_MS, engine = sync } = options

  // Subscribed before the record exists, on purpose. The engine may already be
  // mid-drain from its own poll and could send this record before `enqueue`
  // resolves here, so events are buffered by id and checked afterwards.
  const seen = new Map<string, SyncEvent>()
  let resolveWait: ((event: SyncEvent | null) => void) | null = null
  let watching: string | null = null

  const unsubscribe = engine.onEvent((event) => {
    if (event.type === 'drained') return
    seen.set(event.record.id, event)
    if (watching && event.record.id === watching) resolveWait?.(event)
  })

  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const record = await enqueue(params)
    watching = record.id

    const settled =
      seen.get(record.id) ??
      (await new Promise<SyncEvent | null>((resolve) => {
        resolveWait = resolve
        timer = setTimeout(() => resolve(null), waitMs)
        // Forced: the user just pressed a button, so `navigator.onLine` — which
        // reports false on a fair number of cheap Android builds while the
        // connection is fine — does not get a vote.
        void engine.flush({ force: true })
      }))

    if (!settled) return { record, result: null, queued: true, error: null }

    if (settled.type === 'sent') {
      return { record: settled.record, result: settled.result as T, queued: false, error: null }
    }

    if (settled.type === 'failed') {
      // Retryable failures stay queued and stay silent: a dropped connection is not
      // news to someone who already knows the tower is down.
      if (settled.failure.retryable) {
        return { record: settled.record, result: null, queued: true, error: null }
      }
      return {
        record: settled.record,
        result: null,
        queued: false,
        error: { kind: settled.failure.kind, message: settled.failure.message },
      }
    }

    return { record, result: null, queued: true, error: null }
  } finally {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
