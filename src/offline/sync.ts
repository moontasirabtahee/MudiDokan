import { SYNC } from '@/lib/constants'
import { isDurable, readMeta, writeMeta } from './db'
import {
  type FailureInfo,
  type OutboxRecord,
  type QueueableOp,
  markFailed,
  markSending,
  markSent,
  nextDue,
  outboxStats,
  recoverStuck,
  retry,
} from './outbox'

/**
 * The replay engine: drains the outbox, one record at a time, in order.
 *
 * Serial by design. Parallel replay would let a payment reach the server before
 * the sale it settles, and on a 3G connection concurrency buys nothing anyway —
 * the round trip is latency-bound, not throughput-bound.
 *
 * React-free and network-free: the caller is injected. That keeps this file
 * testable in a bare Node process and keeps `supabase.ts`, which throws at module
 * load without env vars, out of the import graph.
 */

export type SyncStatus = 'idle' | 'syncing' | 'error'

export interface SyncState {
  online: boolean
  status: SyncStatus
  /** Records still waiting, including ones backing off. */
  pending: number
  /** Records that will not retry without a human deciding something. */
  failed: number
  /** Taka value of everything not yet sent. */
  amount: number
  lastSyncedAt: number | null
  lastError: string | null
  /** False when IndexedDB was unavailable and the queue lives only in memory. */
  durable: boolean
}

export type RpcCaller = (op: QueueableOp, args: Record<string, unknown>) => Promise<unknown>
export type Classifier = (error: unknown) => FailureInfo

export type SyncEvent =
  | { type: 'sent'; record: OutboxRecord; result: unknown }
  | { type: 'failed'; record: OutboxRecord; failure: FailureInfo }
  | { type: 'drained' }
  | { type: 'mutated'; op?: string }

const LAST_SYNC_META = 'lastSyncedAt'

/**
 * Duck-types `AppError` rather than importing it.
 *
 * `AppError` carries `kind` and `retryable`, and that shape is all this module
 * needs. Importing the class would drag in the Supabase client and its env
 * validation, which is a steep price for one `instanceof`.
 */
function defaultClassify(error: unknown): FailureInfo {
  const candidate = error as { kind?: unknown; retryable?: unknown; message?: unknown } | null
  if (candidate && typeof candidate.kind === 'string' && typeof candidate.retryable === 'boolean') {
    return {
      message: typeof candidate.message === 'string' ? candidate.message : 'সমস্যা হয়েছে',
      kind: candidate.kind,
      retryable: candidate.retryable,
    }
  }
  // An error we cannot classify is treated as weather. Retrying something that
  // was really a permanent failure costs a few pointless requests; refusing to
  // retry something that was really a dropped connection costs a sale.
  return {
    message: candidate && typeof candidate.message === 'string' ? candidate.message : String(error),
    kind: 'server',
    retryable: true,
  }
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

export interface SyncEngineOptions {
  call?: RpcCaller | null
  classify?: Classifier
  /** Injected in tests so a drain does not have to wait on real timers. */
  now?: () => number
}

export interface SyncEngine {
  getState: () => SyncState
  subscribe: (listener: (state: SyncState) => void) => () => void
  onEvent: (listener: (event: SyncEvent) => void) => () => void
  setCaller: (call: RpcCaller | null) => void
  start: () => Promise<void>
  stop: () => void
  /** Attempt a drain. `force` ignores `navigator.onLine` — the user pressed send. */
  flush: (options?: { force?: boolean }) => Promise<void>
  refresh: () => Promise<void>
  notifyMutation: (op?: string) => void
}

export function createSyncEngine(options: SyncEngineOptions = {}): SyncEngine {
  const classify = options.classify ?? defaultClassify
  const now = options.now ?? (() => Date.now())
  let call = options.call ?? null

  let state: SyncState = {
    online: browserOnline(),
    status: 'idle',
    pending: 0,
    failed: 0,
    amount: 0,
    lastSyncedAt: null,
    lastError: null,
    durable: true,
  }

  const stateListeners = new Set<(state: SyncState) => void>()
  const eventListeners = new Set<(event: SyncEvent) => void>()
  let draining = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let started = false
  let detach: (() => void)[] = []

  /**
   * `useSyncExternalStore` compares snapshots by identity, so a new object every
   * call would loop forever. Replace it only when something actually changed.
   */
  function set(changes: Partial<SyncState>): void {
    const next = { ...state, ...changes }
    const changed = (Object.keys(next) as (keyof SyncState)[]).some((k) => next[k] !== state[k])
    if (!changed) return
    state = next
    for (const listener of stateListeners) listener(state)
  }

  function emit(event: SyncEvent): void {
    for (const listener of eventListeners) listener(event)
  }

  async function refresh(): Promise<void> {
    const stats = await outboxStats()
    set({ pending: stats.pending + stats.sending, failed: stats.failed, amount: stats.amount })
    scheduleWake(stats.wakeAt)
  }

  function scheduleWake(wakeAt: number | null): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (wakeAt == null || !started) return
    const delay = Math.max(200, Math.min(wakeAt - now(), SYNC.pollMs))
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, delay)
  }

  async function sendOne(record: OutboxRecord): Promise<'sent' | 'stop' | 'skip'> {
    if (!call) return 'stop'
    await markSending(record.id)
    try {
      const result = await call(record.op, record.args)
      await markSent(record.id)
      const at = now()
      await writeMeta(LAST_SYNC_META, at)
      set({ lastSyncedAt: at, lastError: null })
      emit({ type: 'sent', record, result })
      return 'sent'
    } catch (error) {
      const failure = classify(error)

      // An expired token is not the record's fault, so it does not spend one of
      // the record's attempts. Put it back untouched and stop: `AuthProvider` is
      // already refreshing, and eight silent attempts against a stale session
      // would bury a day of real sales in the failed list.
      if (failure.kind === 'auth') {
        await retry(record.id)
        set({ status: 'error', lastError: failure.message })
        return 'stop'
      }

      const updated = await markFailed(record.id, failure)
      emit({ type: 'failed', record: updated ?? record, failure })
      if (failure.retryable) {
        // The network is down or the server is unwell. Nothing after this record
        // will fare better, and the queue has to stay in order regardless.
        set({ status: 'error', lastError: failure.message, online: browserOnline() })
        return 'stop'
      }
      // A permanent rejection of one record. Leave it flagged for a human and
      // carry on — one bad entry must not hold a day of sales hostage.
      set({ lastError: failure.message })
      return 'skip'
    }
  }

  async function flush(flushOptions: { force?: boolean } = {}): Promise<void> {
    if (draining) return
    if (!call) return
    // `navigator.onLine` lies in both directions: true behind a captive portal,
    // and occasionally false on Android while a connection is in fact up. It is
    // used only to avoid burning battery on a certainly-dead radio, and the slow
    // poll plus the explicit send button cover the false negatives.
    if (!flushOptions.force && !browserOnline()) {
      set({ online: false })
      await refresh()
      return
    }

    draining = true
    set({ status: 'syncing' })
    try {
      let guard = 0
      for (;;) {
        if (++guard > 500) break // paranoia: never spin forever on a bad record
        const record = await nextDue(now())
        if (!record) break
        const outcome = await sendOne(record)
        if (outcome === 'stop') break
      }
    } finally {
      draining = false
      const stats = await outboxStats()
      const stalled = state.status === 'error' || stats.failed > 0
      const empty = stats.pending + stats.sending === 0
      set({
        pending: stats.pending + stats.sending,
        failed: stats.failed,
        amount: stats.amount,
        status: stalled ? 'error' : 'idle',
        // A clean sweep clears the last complaint. Anything still stuck keeps it,
        // because that message is what the pending list shows the shopkeeper.
        lastError: stalled ? state.lastError : null,
      })
      if (empty) emit({ type: 'drained' })
      scheduleWake(stats.wakeAt)
    }
  }

  async function start(): Promise<void> {
    if (started) return
    started = true

    set({ lastSyncedAt: await readMeta<number | null>(LAST_SYNC_META, null) })
    // A false here means IndexedDB refused to open and the queue is RAM-only. The
    // app shell shows a standing warning: closing the tab loses unsent sales.
    set({ durable: await isDurable() })
    // Anything left mid-flight from a previous run. Safe to resend because every
    // queueable operation is keyed on a client-generated uuid.
    await recoverStuck()

    if (typeof window !== 'undefined') {
      const onOnline = () => {
        set({ online: true, status: 'idle', lastError: null })
        void flush()
      }
      const onOffline = () => set({ online: false })
      const onVisible = () => {
        if (document.visibilityState === 'visible') void flush()
      }
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      document.addEventListener('visibilitychange', onVisible)
      detach = [
        () => window.removeEventListener('online', onOnline),
        () => window.removeEventListener('offline', onOffline),
        () => document.removeEventListener('visibilitychange', onVisible),
      ]
    }

    poll = setInterval(() => void flush(), SYNC.pollMs)
    await flush()
  }

  function stop(): void {
    started = false
    if (timer) clearTimeout(timer)
    if (poll) clearInterval(poll)
    timer = null
    poll = null
    for (const off of detach) off()
    detach = []
  }

  return {
    getState: () => state,
    subscribe(listener) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    onEvent(listener) {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    setCaller(next) {
      call = next
    },
    start,
    stop,
    flush,
    refresh,
    notifyMutation(op?: string) {
      emit({ type: 'mutated', op })
    },
  }
}

/**
 * The app's engine.
 *
 * Created eagerly but inert: it has no way to reach the network until `main.tsx`
 * hands it one with `setRpcCaller`. That keeps the Supabase client out of this
 * module's imports while still giving components a single object to subscribe to.
 */
export const sync: SyncEngine = createSyncEngine()

export function setRpcCaller(call: RpcCaller | null): void {
  sync.setCaller(call)
}

/** Wiring for `useSyncExternalStore`. */
export const subscribeSync = sync.subscribe
export const getSyncSnapshot = sync.getState
