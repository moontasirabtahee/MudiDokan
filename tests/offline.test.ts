import {
  cacheKey,
  clearStore,
  deviceId,
  dropShopCache,
  isDurable,
  pruneCache,
  readCache,
  readMeta,
  writeCache,
  writeMeta,
} from '@/offline/db'
import {
  type OutboxRecord,
  backoffFor,
  discard,
  discardAll,
  enqueue,
  hasWork,
  isQueueableOp,
  listOutbox,
  markFailed,
  markSending,
  markSent,
  nextDue,
  outboxStats,
  recordIdFor,
  recoverStuck,
  retry,
  retryAll,
} from '@/offline/outbox'
import { createSyncEngine } from '@/offline/sync'
import { MAX_RETRIES, RETRY_SCHEDULE } from '@/lib/constants'
import { deepEq, eq, notOk, ok, suite, throws } from './_harness'

// There is no IndexedDB in a bare Node process, so every assertion below runs
// against the memory fallback — which is exactly the path a Firefox private
// window takes, and therefore worth exercising deliberately.
const warn = console.warn
console.warn = () => {}
ok(!(await isDurable()), 'no IndexedDB here, so the memory fallback is in play')
console.warn = warn

const SHOP = '11111111-1111-4111-8111-111111111111'
const OTHER_SHOP = '22222222-2222-4222-8222-222222222222'

// Every RPC in this schema takes one wrapped `{ payload }` argument, and the
// outbox stores that object verbatim so `sync.ts` can hand it straight to `rpc()`.
// The tests build args the same way the app does, or they would be testing a
// shape that never reaches Postgres.
function sale(clientUuid: string, total = 550) {
  return {
    payload: {
      shop_id: SHOP,
      client_uuid: clientUuid,
      items: [{ product_id: 'p1', qty: 1, unit_price: total }],
      paid: total,
    },
  }
}

function expense(clientUuid: string, amount: number) {
  return { payload: { shop_id: SHOP, client_uuid: clientUuid, amount } }
}

/** What a queued record's idempotency key is, from the engine's point of view. */
function keyOf(args: Record<string, unknown>): string {
  const payload = (args.payload ?? args) as Record<string, unknown>
  return String(payload.client_uuid ?? args.p_sale_id)
}

async function reset() {
  await clearStore('outbox')
}

/* ── Idempotency keys ───────────────────────────────────────────────────── */

suite('the record id is the idempotency key')
eq(recordIdFor('create_sale', { payload: { client_uuid: 'abc' } }), 'abc', 'payload ops use client_uuid')
eq(recordIdFor('void_sale', { p_sale_id: 's1' }), 'void:s1', 'a void is keyed on its target')
eq(
  recordIdFor('void_sale', { p_sale_id: 's1' }),
  recordIdFor('void_sale', { p_sale_id: 's1', p_reason: 'wrong item' }),
  'so pressing void twice collapses onto one entry',
)
throws(
  () => recordIdFor('create_sale', { payload: { shop_id: SHOP } }),
  'refuses to queue a write with no idempotency key — that is how sales get double-counted',
  /client_uuid/,
)
ok(isQueueableOp('create_sale'), 'sales are queueable')
notOk(isQueueableOp('create_shop_with_owner'), 'shop creation is not — you wait for that one')
notOk(isQueueableOp('invite_member'), 'nor is inviting staff')

/* ── Queue mechanics ────────────────────────────────────────────────────── */

suite('enqueue and FIFO order')
await reset()
await enqueue({ op: 'create_sale', args: sale('s-1', 100), shopId: SHOP, label: 'বিক্রি ১', amount: 100 })
await enqueue({ op: 'create_expense', args: expense('e-1', 50), shopId: SHOP, label: 'খরচ', amount: 50 })
await enqueue({ op: 'create_sale', args: sale('s-2', 200), shopId: SHOP, label: 'বিক্রি ২', amount: 200 })
deepEq(
  (await listOutbox()).map((r) => r.id),
  ['s-1', 'e-1', 's-2'],
  'replay order is the order the shopkeeper did the work in',
)

let stats = await outboxStats()
eq(stats.pending, 3, 'three waiting')
eq(stats.failed, 0, 'none failed')
eq(stats.amount, 350, 'the pending list can total itself without parsing args')
ok(stats.oldestAt !== null, 'and knows how long the oldest has been waiting')

suite('re-enqueuing the same key is a no-op, not a duplicate')
await enqueue({ op: 'create_sale', args: sale('s-1', 100), shopId: SHOP, label: 'বিক্রি ১', amount: 100 })
eq((await listOutbox()).length, 3, 'still three records')
deepEq(
  (await listOutbox()).map((r) => r.id),
  ['s-1', 'e-1', 's-2'],
  'and it keeps its original place in the queue',
)

suite('scoping by shop')
await enqueue({ op: 'create_sale', args: { payload: { ...sale('s-3').payload, shop_id: OTHER_SHOP } }, shopId: OTHER_SHOP, label: 'other', amount: 999 })
eq((await outboxStats(SHOP)).pending, 3, 'one shop')
eq((await outboxStats(OTHER_SHOP)).pending, 1, 'does not see the other')
eq((await outboxStats()).amount, 1349, 'unscoped covers both')
await discard('s-3')

/* ── Failure handling ───────────────────────────────────────────────────── */

suite('a retryable failure backs off and stays in the queue')
await reset()
await enqueue({ op: 'create_sale', args: sale('r-1'), shopId: SHOP, label: 'বিক্রি', amount: 550 })
const backedOff = await markFailed('r-1', { message: 'Failed to fetch', kind: 'offline', retryable: true })
eq(backedOff?.status, 'pending', 'still pending')
eq(backedOff?.attempts, 1, 'one attempt spent')
ok((backedOff?.nextAttemptAt ?? 0) > Date.now(), 'and not eligible again immediately')
eq(await nextDue(Date.now()), null, 'so a drain right now finds nothing')
ok((await nextDue(Date.now() + 120_000)) !== null, 'but it comes back when the backoff expires')

suite('a permanent rejection goes terminal — retrying it forever would hide the problem')
const rejected = await markFailed('r-1', { message: 'বাকির সীমা পার', kind: 'validation', retryable: false })
eq(rejected?.status, 'failed', 'failed')
eq(rejected?.errorKind, 'validation', 'and remembers why')
eq(await nextDue(Date.now() + 10_000_000), null, 'never eligible again on its own')
eq((await outboxStats()).failed, 1, 'and is surfaced as needing a human')
notOk(await hasWork(), 'a terminally failed record is not "work in progress"')

suite('the user can put it back, or throw it away')
eq((await retry('r-1'))?.status, 'pending', 'retry')
eq((await retry('r-1'))?.attempts, 0, 'with a clean slate')
await markFailed('r-1', { message: 'nope', kind: 'permission', retryable: false })
eq(await retryAll(SHOP), 1, 'retryAll reports what it moved')
await markFailed('r-1', { message: 'nope', kind: 'permission', retryable: false })
eq(await discardAll(SHOP), 1, 'discardAll too')
eq((await listOutbox()).length, 0, 'and the queue is empty')

suite('retries are not infinite')
await reset()
await enqueue({ op: 'create_sale', args: sale('x-1'), shopId: SHOP, label: 'বিক্রি', amount: 10 })
let last: OutboxRecord | null = null
for (let i = 0; i < MAX_RETRIES; i += 1) {
  last = await markFailed('x-1', { message: 'timeout', kind: 'server', retryable: true })
}
eq(last?.attempts, MAX_RETRIES, `gives up after ${MAX_RETRIES} attempts`)
eq(last?.status, 'failed', 'and asks for help rather than draining the battery')

suite('backoff')
ok(backoffFor(1) >= RETRY_SCHEDULE[0] * 0.8, 'first retry is quick')
ok(backoffFor(1) <= RETRY_SCHEDULE[0] * 1.2, 'within the jitter band')
ok(backoffFor(99) <= RETRY_SCHEDULE[RETRY_SCHEDULE.length - 1] * 1.2, 'and caps at the last step')
ok(backoffFor(5) > backoffFor(1), 'later retries wait longer')
// Two devices in one shop reconnect the instant the router does. Identical
// backoff would have them retrying in lockstep forever.
const draws = new Set(Array.from({ length: 20 }, () => backoffFor(3)))
ok(draws.size > 1, 'jitter actually varies')

suite('recovery after the app is killed mid-send')
await reset()
await enqueue({ op: 'create_sale', args: sale('k-1'), shopId: SHOP, label: 'বিক্রি', amount: 80 })
await markSending('k-1')
eq(await nextDue(), null, 'nothing else may be sent while one is in flight')
eq(await recoverStuck(), 1, 'startup finds the orphan')
eq((await listOutbox())[0].status, 'pending', 'and re-queues it — client_uuid makes that safe')

/* ── The replay engine ──────────────────────────────────────────────────── */

suite('the engine drains in order')
await reset()
const sent: string[] = []
const engine = createSyncEngine({
  call: async (op, args) => {
    sent.push(keyOf(args))
    return { ok: true }
  },
})
await enqueue({ op: 'create_sale', args: sale('a', 100), shopId: SHOP, label: 'a', amount: 100 })
await enqueue({ op: 'record_payment', args: { payload: { shop_id: SHOP, client_uuid: 'b', party: 'customer' as const, amount: 40 } }, shopId: SHOP, label: 'b', amount: 40 })
await enqueue({ op: 'create_sale', args: sale('c', 300), shopId: SHOP, label: 'c', amount: 300 })
await engine.flush()
deepEq(sent, ['a', 'b', 'c'], 'a payment can never overtake the sale it settles')
eq((await listOutbox()).length, 0, 'sent records are deleted — the server is the record of truth')
eq(engine.getState().pending, 0, 'state agrees')
eq(engine.getState().status, 'idle', 'idle')
ok(engine.getState().lastSyncedAt !== null, 'and it remembers when')

suite('a dropped connection stops the drain, keeps the order, and loses nothing')
await reset()
let attempts = 0
const flaky = createSyncEngine({
  call: async () => {
    attempts += 1
    const error = new Error('Failed to fetch') as Error & { kind: string; retryable: boolean }
    error.kind = 'offline'
    error.retryable = true
    throw error
  },
})
await enqueue({ op: 'create_sale', args: sale('f-1'), shopId: SHOP, label: 'f1', amount: 100 })
await enqueue({ op: 'create_sale', args: sale('f-2'), shopId: SHOP, label: 'f2', amount: 200 })
await flaky.flush()
eq(attempts, 1, 'it stops at the first failure instead of hammering the whole queue')
eq((await listOutbox()).length, 2, 'both sales are still on the phone')
eq(flaky.getState().status, 'error', 'and the UI can say so')
eq(flaky.getState().pending, 2, 'with an honest count')
eq(flaky.getState().amount, 300, 'and an honest total')
flaky.stop()

suite('one poisoned record does not hold a day of sales hostage')
await reset()
const seen: string[] = []
const mixed = createSyncEngine({
  call: async (_op, args) => {
    const key = keyOf(args)
    seen.push(key)
    if (key === 'bad') {
      const error = new Error('এই খরিদ্দারের বাকির সীমা পার') as Error & { kind: string; retryable: boolean }
      error.kind = 'validation'
      error.retryable = false
      throw error
    }
    return { ok: true }
  },
})
await enqueue({ op: 'create_sale', args: sale('good-1'), shopId: SHOP, label: 'g1', amount: 100 })
await enqueue({ op: 'create_sale', args: sale('bad'), shopId: SHOP, label: 'bad', amount: 100 })
await enqueue({ op: 'create_sale', args: sale('good-2'), shopId: SHOP, label: 'g2', amount: 100 })
await mixed.flush()
deepEq(seen, ['good-1', 'bad', 'good-2'], 'the drain carries on past the rejection')
deepEq((await listOutbox()).map((r) => r.id), ['bad'], 'only the rejected one is left behind')
eq((await listOutbox())[0].status, 'failed', 'flagged for a person')
eq(mixed.getState().failed, 1, 'and counted separately from pending')
eq(mixed.getState().status, 'error', 'the shop needs to know something is stuck')
mixed.stop()

suite('an engine with no caller wired up does nothing, quietly')
await reset()
await enqueue({ op: 'create_sale', args: sale('idle-1'), shopId: SHOP, label: 'i', amount: 1 })
const inert = createSyncEngine()
await inert.flush()
eq((await listOutbox()).length, 1, 'the record survives until main.tsx hands over a caller')

suite('subscribers and events')
await reset()
const events: string[] = []
const watched = createSyncEngine({ call: async () => ({ ok: true }) })
const offEvents = watched.onEvent((event) => events.push(event.type))
let notifications = 0
const offState = watched.subscribe(() => { notifications += 1 })
const first = watched.getState()
eq(watched.getState(), first, 'the snapshot is referentially stable until something changes')
await enqueue({ op: 'create_expense', args: expense('ev-1', 20), shopId: SHOP, label: 'ev', amount: 20 })
await watched.flush()
ok(notifications > 0, 'subscribers hear about it')
ok(events.includes('sent'), 'a sent event lets data hooks refetch')
ok(events.includes('drained'), 'and a drained event lets the banner disappear')
notOk(watched.getState() === first, 'the snapshot changed identity exactly once per change')
offEvents()
offState()
watched.stop()

/* ── Caches and meta ────────────────────────────────────────────────────── */

suite('read cache is scoped per shop')
eq(cacheKey(SHOP, 'products'), `${SHOP}:products`, 'keys carry the shop')
await writeCache(SHOP, 'products', [{ id: 'p1', name: 'চিনি' }])
await writeCache(OTHER_SHOP, 'products', [{ id: 'p9', name: 'Sugar' }])
deepEq((await readCache<{ id: string }[]>(SHOP, 'products'))?.data, [{ id: 'p1', name: 'চিনি' }], 'reads back')
deepEq(
  (await readCache<{ id: string }[]>(OTHER_SHOP, 'products'))?.data,
  [{ id: 'p9', name: 'Sugar' }],
  'a shopkeeper working at two shops never sees the wrong catalogue',
)
eq(await readCache(SHOP, 'nothing-here'), null, 'a miss is null')
eq(await readCache(SHOP, 'products', -1), null, 'stale beyond its TTL counts as a miss')
await dropShopCache(OTHER_SHOP)
eq(await readCache(OTHER_SHOP, 'products'), null, 'dropped on sign-out')
ok((await readCache(SHOP, 'products')) !== null, 'without touching the other shop')
eq(await pruneCache(-1), 1, 'pruning sweeps what is left')

suite('meta')
await writeMeta('probe', { a: 1 })
deepEq(await readMeta('probe', null), { a: 1 }, 'round trip')
deepEq(await readMeta('absent', { fallback: true }), { fallback: true }, 'fallback')
const device = await deviceId()
ok(/^[0-9a-f-]{36}$/.test(device), 'the device gets a stable id')
eq(await deviceId(), device, 'stable across calls')
eq((await enqueue({ op: 'create_sale', args: sale('dev-1'), shopId: SHOP, label: 'd', amount: 1 })).device, device, 'and every queued record is attributed to it')
await reset()
