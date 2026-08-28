import { MAX_RETRIES, RETRY_SCHEDULE } from '@/lib/constants'
import type { Database } from '@/lib/database.types'
import { allRecords, deleteRecord, deviceId, getRecord, putRecord, recordsByIndex } from './db'

/**
 * The durable write queue.
 *
 * This module is the reason a shopkeeper can keep selling through a four-hour
 * power cut at the exchange. Every write in the application goes through it —
 * including writes made while online, which are enqueued and then drained
 * immediately. One path means the offline path is exercised on every single sale
 * rather than only when the network happens to be down, which is the only way a
 * feature like this stays working.
 *
 * Deliberately free of any network or React import so it can be tested in a bare
 * Node process. `sync.ts` owns the part that talks to Supabase.
 */

type Fns = Database['public']['Functions']

/**
 * Only idempotent operations may be queued.
 *
 * The first six carry a device-generated `client_uuid` that the RPC looks up
 * before inserting, so a resend after an ambiguous timeout returns the original
 * row instead of double-counting a sale. `void_sale` has no such key and does not
 * need one: it asserts a target state, and voiding an already-void sale returns
 * the sale unchanged.
 *
 * Shop creation, invitations and role changes are absent on purpose. They need a
 * result the user is waiting on, and queuing them would mean showing somebody an
 * empty shop that might exist later.
 */
export const QUEUEABLE_OPS = [
  'create_sale',
  'create_purchase',
  'record_payment',
  'adjust_stock',
  'create_expense',
  'set_opening_balance',
  'void_sale',
] as const

export type QueueableOp = (typeof QUEUEABLE_OPS)[number]

export function isQueueableOp(value: string): value is QueueableOp {
  return (QUEUEABLE_OPS as readonly string[]).includes(value)
}

/** No 'done': a record that lands is deleted. The server is the record of truth. */
export type OutboxStatus = 'pending' | 'sending' | 'failed'

export interface OutboxRecord {
  /** Also the idempotency key — see `recordIdFor`. */
  id: string
  /** Monotonic within a session; the tiebreaker that keeps the queue FIFO. */
  seq: number
  shopId: string
  op: QueueableOp
  args: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  createdAt: string
  updatedAt: string
  /** Epoch ms. A pending record is not eligible before this. */
  nextAttemptAt: number
  device: string
  /** What the user sees in the pending list: 'বিক্রি — ৳৫৫০'. */
  label: string
  /** Money involved, so the pending list can total itself without parsing args. */
  amount: number | null
  lastError: string | null
  errorKind: string | null
}

export interface EnqueueParams<K extends QueueableOp> {
  op: K
  args: Fns[K]['Args']
  shopId: string
  label: string
  amount?: number | null
}

/* ── Ordering ───────────────────────────────────────────────────────────── */

let seqCounter = 0

/**
 * Two sales rung up in the same millisecond must still replay in the order they
 * were made — a sale and its correction, most obviously. Wall clock gives the
 * ordering across sessions, the counter gives it within one.
 */
function nextSeq(): number {
  seqCounter = (seqCounter + 1) % 1000
  return Date.now() * 1000 + seqCounter
}

function byQueueOrder(a: OutboxRecord, b: OutboxRecord): number {
  return a.seq - b.seq || a.createdAt.localeCompare(b.createdAt)
}

/**
 * The record id doubles as the idempotency key, so a retry is indistinguishable
 * from the first attempt as far as the database is concerned. For the payload
 * operations that is the `client_uuid` the caller already generated; for
 * `void_sale` it is derived from the target, so pressing void twice collapses onto
 * one queue entry instead of two.
 *
 * `args` is the RPC's argument object verbatim, which for every operation but
 * `void_sale` means a single wrapped `{ payload }` — hence the descent. Storing it
 * verbatim is what lets `sync.ts` hand a record straight to `rpc()` without
 * knowing anything about the shape of any particular call.
 */
export function recordIdFor(op: QueueableOp, args: Record<string, unknown>): string {
  if (op === 'void_sale') return `void:${String(args.p_sale_id)}`

  const payload =
    typeof args.payload === 'object' && args.payload !== null
      ? (args.payload as Record<string, unknown>)
      : args

  const clientUuid = payload.client_uuid
  if (typeof clientUuid !== 'string' || !clientUuid) {
    throw new Error(`${op} must carry a client_uuid before it can be queued`)
  }
  return clientUuid
}

/* ── Writing ────────────────────────────────────────────────────────────── */

export async function enqueue<K extends QueueableOp>(
  params: EnqueueParams<K>,
): Promise<OutboxRecord> {
  const args = params.args as unknown as Record<string, unknown>
  const id = recordIdFor(params.op, args)
  const now = new Date().toISOString()

  // Re-enqueuing the same key is not an error — an optimistic UI may replay a
  // user's tap. Keep the original position in the queue and clear any failure.
  const existing = await getRecord<OutboxRecord>('outbox', id)

  const record: OutboxRecord = {
    id,
    seq: existing?.seq ?? nextSeq(),
    shopId: params.shopId,
    op: params.op,
    args,
    status: 'pending',
    attempts: 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nextAttemptAt: Date.now(),
    device: await deviceId(),
    label: params.label,
    amount: params.amount ?? null,
    lastError: null,
    errorKind: null,
  }

  await putRecord('outbox', record)
  return record
}

async function patch(id: string, changes: Partial<OutboxRecord>): Promise<OutboxRecord | null> {
  const current = await getRecord<OutboxRecord>('outbox', id)
  if (!current) return null
  const next: OutboxRecord = { ...current, ...changes, updatedAt: new Date().toISOString() }
  await putRecord('outbox', next)
  return next
}

export async function markSending(id: string): Promise<OutboxRecord | null> {
  return patch(id, { status: 'sending' })
}

/** Landed. The row is gone; the server has it. */
export async function markSent(id: string): Promise<void> {
  await deleteRecord('outbox', id)
}

export interface FailureInfo {
  message: string
  kind: string
  retryable: boolean
}

/**
 * A failure is either weather or a decision.
 *
 * Network and server errors are weather: back off and try again, up to
 * `MAX_RETRIES`. Permission, validation, billing and conflict errors will fail
 * identically forever, so retrying them just burns battery and hides the problem
 * — those go terminal and wait for a person.
 */
export async function markFailed(id: string, failure: FailureInfo): Promise<OutboxRecord | null> {
  const current = await getRecord<OutboxRecord>('outbox', id)
  if (!current) return null
  const attempts = current.attempts + 1
  const exhausted = attempts >= MAX_RETRIES
  const willRetry = failure.retryable && !exhausted

  return patch(id, {
    attempts,
    status: willRetry ? 'pending' : 'failed',
    nextAttemptAt: willRetry ? Date.now() + backoffFor(attempts) : current.nextAttemptAt,
    lastError: failure.message,
    errorKind: failure.kind,
  })
}

/**
 * Backoff with jitter. The jitter is not decoration: a shop with a counter tablet
 * and the owner's phone both come back online the instant the router does, and
 * without it they retry in lockstep forever.
 */
export function backoffFor(attempts: number): number {
  const base = RETRY_SCHEDULE[Math.min(attempts, RETRY_SCHEDULE.length) - 1] ?? RETRY_SCHEDULE[0]
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.max(250, Math.round(base + jitter))
}

/** Put a terminally failed record back in the queue, at the user's request. */
export async function retry(id: string): Promise<OutboxRecord | null> {
  return patch(id, { status: 'pending', attempts: 0, nextAttemptAt: Date.now(), lastError: null })
}

/** Give up on one entry. Used by "cancel" on a sale that never left the phone. */
export async function discard(id: string): Promise<void> {
  await deleteRecord('outbox', id)
}

/**
 * Called once on startup.
 *
 * A record left in 'sending' means the app was killed mid-flight — a call the
 * shopkeeper's phone made and never heard back from. Whether it reached Postgres
 * is unknowable from here, which is exactly the case `client_uuid` exists for, so
 * the safe move is to send it again.
 */
export async function recoverStuck(): Promise<number> {
  const stuck = await recordsByIndex<OutboxRecord>('outbox', 'by_status', 'sending')
  for (const record of stuck) {
    await patch(record.id, { status: 'pending', nextAttemptAt: Date.now() })
  }
  return stuck.length
}

/* ── Reading ────────────────────────────────────────────────────────────── */

export interface ListFilter {
  shopId?: string
  status?: OutboxStatus
}

export async function listOutbox(filter: ListFilter = {}): Promise<OutboxRecord[]> {
  const rows = filter.status
    ? await recordsByIndex<OutboxRecord>('outbox', 'by_status', filter.status)
    : await allRecords<OutboxRecord>('outbox')
  const scoped = filter.shopId ? rows.filter((r) => r.shopId === filter.shopId) : rows
  return scoped.sort(byQueueOrder)
}

/**
 * The next record to send, or null.
 *
 * Strictly one at a time and strictly in order: a payment against a sale that has
 * not landed yet would be rejected, and parallelism buys nothing on a connection
 * this thin anyway.
 */
export async function nextDue(now = Date.now()): Promise<OutboxRecord | null> {
  const rows = await listOutbox()
  if (rows.some((r) => r.status === 'sending')) return null
  return rows.find((r) => r.status === 'pending' && r.nextAttemptAt <= now) ?? null
}

/** Is anything at all still waiting, ignoring when it is next due? */
export async function hasWork(): Promise<boolean> {
  const rows = await listOutbox()
  return rows.some((r) => r.status === 'pending' || r.status === 'sending')
}

export interface OutboxStats {
  pending: number
  sending: number
  failed: number
  total: number
  /** Sum of `amount` over everything not yet sent. */
  amount: number
  /** When the oldest unsent entry was made — drives the "since Tuesday" warning. */
  oldestAt: string | null
  /** Earliest epoch ms at which some pending record becomes eligible. */
  wakeAt: number | null
}

export async function outboxStats(shopId?: string): Promise<OutboxStats> {
  const rows = await listOutbox(shopId ? { shopId } : {})
  const unsent = rows.filter((r) => r.status !== 'failed')
  const waiting = rows.filter((r) => r.status === 'pending')
  return {
    pending: waiting.length,
    sending: rows.filter((r) => r.status === 'sending').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    total: rows.length,
    amount: unsent.reduce((total, r) => total + (r.amount ?? 0), 0),
    oldestAt: unsent.length ? unsent[0].createdAt : null,
    wakeAt: waiting.length ? Math.min(...waiting.map((r) => r.nextAttemptAt)) : null,
  }
}

export async function retryAll(shopId?: string): Promise<number> {
  const failed = await listOutbox({ shopId, status: 'failed' })
  for (const record of failed) await retry(record.id)
  return failed.length
}

export async function discardAll(shopId?: string): Promise<number> {
  const failed = await listOutbox({ shopId, status: 'failed' })
  for (const record of failed) await discard(record.id)
  return failed.length
}
