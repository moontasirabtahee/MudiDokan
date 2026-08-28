import { clearStore } from '@/offline/db'
import { type OutboxRecord, listOutbox } from '@/offline/outbox'
import { submit } from '@/offline/submit'
import { type RpcCaller, createSyncEngine } from '@/offline/sync'
import { eq, notOk, ok, rejects, suite } from './_harness'

/**
 * The write path.
 *
 * Every rupee this app records passes through `submit`, and its whole job is to
 * answer one question honestly: is the shopkeeper's work safe, and does the server
 * know about it yet. These tests hold it to the three answers it promises —
 * `sent`, `queued`, `failed` — because each one drives a different thing on screen,
 * and getting them confused means either a receipt number that does not exist or a
 * refused credit sale that nobody mentioned.
 *
 * Each case gets its own engine over the shared in-memory outbox, so a caller that
 * never answers in one test cannot leave a drain running through the next.
 */

const SHOP = '11111111-1111-4111-8111-111111111111'

// Bare Node has no IndexedDB, so every case below runs on the memory fallback and
// the first store access warns about it. That warning is the subject of a test in
// `offline.test.ts`; here it is just noise over the results.
console.warn = () => {}

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

function params(clientUuid: string, total = 550) {
  return { op: 'create_sale' as const, args: sale(clientUuid, total), shopId: SHOP, label: 'বিক্রি', amount: total }
}

async function withEngine<T>(call: RpcCaller, run: (engine: ReturnType<typeof createSyncEngine>) => Promise<T>) {
  await clearStore('outbox')
  const engine = createSyncEngine({ call })
  try {
    return await run(engine)
  } finally {
    engine.stop()
    await clearStore('outbox')
  }
}

/* ── Sent ───────────────────────────────────────────────────────────────── */

suite('submit — the server answered')

await withEngine(
  async () => ({ sale_id: 'srv-1', invoice_no: 42 }),
  async (engine) => {
    const out = await submit<'create_sale', { sale_id: string; invoice_no: number }>(
      params('11111111-aaaa-4aaa-8aaa-000000000001'),
      { engine, waitMs: 500 },
    )
    notOk(out.queued, 'a server that answers inside the wait is not reported as queued')
    ok(out.result, 'the caller gets the result it needs for a receipt')
    eq(out.result?.invoice_no, 42, 'the RPC return value is passed through untouched')
    eq(out.error, null, 'no error on a clean write')
    eq((await listOutbox()).length, 0, 'a record that landed is deleted, not marked done')
  },
)

/* ── Queued ─────────────────────────────────────────────────────────────── */

suite('submit — the server did not answer in time')

await withEngine(
  // The shape of a dead tower: the request goes out and nothing comes back. This
  // is the case the whole application is built around, so it is tested with a
  // caller that genuinely never settles rather than one that rejects.
  () => new Promise<never>(() => {}),
  async (engine) => {
    const started = Date.now()
    const out = await submit(params('11111111-aaaa-4aaa-8aaa-000000000002'), { engine, waitMs: 60 })
    ok(Date.now() - started >= 55, 'it waited for the answer before giving up on one')
    ok(out.queued, 'no answer means queued, which is a success as far as the shop is concerned')
    eq(out.result, null, 'nothing may be read from a result the server never sent')
    eq(out.error, null, 'a slow server is not an error the shopkeeper needs to see')

    const rows = await listOutbox()
    eq(rows.length, 1, 'the sale is still on the phone')
    eq(rows[0].amount, 550, 'with its amount, so the pending list can total itself')
    eq(rows[0].label, 'বিক্রি', 'and a label a shopkeeper can recognise')
  },
)

/* ── Refused ────────────────────────────────────────────────────────────── */

suite('submit — the server refused, permanently')

await withEngine(
  () => Promise.reject({ kind: 'validation', retryable: false, message: 'বাকির সীমা পার হয়ে যাচ্ছে' }),
  async (engine) => {
    const out = await submit(params('11111111-aaaa-4aaa-8aaa-000000000003'), { engine, waitMs: 500 })
    notOk(out.queued, 'a refusal that will never succeed must not be reported as queued')
    eq(out.result, null, 'and carries no result')
    const error = out.error as { kind: string; message: string }
    eq(error.kind, 'validation', 'the kind survives, so the UI can choose its tone')
    eq(
      error.message,
      'বাকির সীমা পার হয়ে যাচ্ছে',
      'the assertion text reaches the screen while the customer is still standing there',
    )

    const rows = await listOutbox()
    eq(rows.length, 1, 'the record stays for a human to look at')
    eq(rows[0].status, 'failed', 'flagged rather than silently retried')
  },
)

/* ── Weather ────────────────────────────────────────────────────────────── */

suite('submit — the connection dropped')

await withEngine(
  () => Promise.reject({ kind: 'offline', retryable: true, message: 'error.network' }),
  async (engine) => {
    const out = await submit(params('11111111-aaaa-4aaa-8aaa-000000000004'), { engine, waitMs: 500 })
    ok(out.queued, 'a retryable failure is queued, not failed')
    eq(out.error, null, 'and stays quiet: a dropped tower is not news to someone who knows')

    const rows = await listOutbox()
    eq(rows[0].status, 'pending', 'it is waiting for the next attempt, not for a person')
    eq(rows[0].attempts, 1, 'the attempt was counted')
    ok(rows[0].nextAttemptAt > Date.now(), 'and backed off rather than retried immediately')
  },
)

/* ── Idempotency ────────────────────────────────────────────────────────── */

suite('submit — the same write twice')

await withEngine(
  () => new Promise<never>(() => {}),
  async (engine) => {
    const uuid = '11111111-aaaa-4aaa-8aaa-000000000005'
    const first = await submit(params(uuid), { engine, waitMs: 20 })
    const second = await submit(params(uuid), { engine, waitMs: 20 })
    eq(first.record.id, uuid, 'the client_uuid is the record id, and so the idempotency key')
    eq(second.record.id, first.record.id, 'a replay lands on the same record')
    eq((await listOutbox()).length, 1, 'a double tap on a dead network queues one sale, not two')
  },
)

/* ── A payload that cannot be queued ────────────────────────────────────── */

suite('submit — a payload with no idempotency key')

await withEngine(
  async () => null,
  async (engine) => {
    // Not a user-facing failure — a programming one. It throws rather than
    // resolving with an error, because a write that cannot be replayed safely must
    // never enter the queue in the first place.
    await rejects(
      () =>
        submit(
          {
            op: 'create_sale',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            args: { payload: { shop_id: SHOP } } as any,
            shopId: SHOP,
            label: 'বিক্রি',
          },
          { engine, waitMs: 20 },
        ),
      'a sale with no client_uuid is refused outright',
      /client_uuid/,
    )
    eq((await listOutbox()).length, 0, 'and nothing is left behind in the queue')
  },
)

/* ── Ordering ───────────────────────────────────────────────────────────── */

suite('submit — a payment behind its sale')

await withEngine(
  async (op) => {
    if (op === 'create_sale') return { sale_id: 'srv-9' }
    return { payment_id: 'pay-9' }
  },
  async (engine) => {
    const seen: string[] = []
    const off = engine.onEvent((event) => {
      if (event.type === 'sent') seen.push(event.record.op)
    })
    await submit(params('11111111-aaaa-4aaa-8aaa-000000000006'), { engine, waitMs: 500 })
    await submit(
      {
        op: 'record_payment',
        args: {
          payload: {
            shop_id: SHOP,
            client_uuid: '11111111-aaaa-4aaa-8aaa-000000000007',
            party_id: 'party-1',
            amount: 550,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        shopId: SHOP,
        label: 'টাকা জমা',
        amount: 550,
      },
      { engine, waitMs: 500 },
    )
    off()
    // The sale has to reach Postgres before the payment that settles it, or the
    // payment is refused for referring to a row that does not exist yet.
    eq(seen.join(' → '), 'create_sale → record_payment', 'the queue replayed in the order it was written')
  },
)

/* ── The race the buffer exists for ─────────────────────────────────────── */

suite('submit — an answer that arrives before enqueue returns')

await withEngine(
  async () => ({ sale_id: 'srv-fast' }),
  async (engine) => {
    // The engine polls on its own, so a record can be sent between `enqueue`
    // writing it and `submit` getting the chance to watch for it. Starting a drain
    // for an *earlier* record and letting it roll onto this one reproduces that
    // ordering: if events were only buffered after the id was known, this would
    // hang for the full wait and report a queued sale that the server already has.
    const early = submit(params('11111111-aaaa-4aaa-8aaa-000000000008'), { engine, waitMs: 400 })
    const out = await submit(params('11111111-aaaa-4aaa-8aaa-000000000009'), { engine, waitMs: 400 })
    await early
    notOk(out.queued, 'the event was caught even though it may have arrived first')
    eq((await listOutbox()).length, 0, 'both landed')
  },
)

/* ── What the engine reports while all this happens ─────────────────────── */

suite('submit — the state a shopkeeper sees')

await withEngine(
  () => new Promise<never>(() => {}),
  async (engine) => {
    await submit(params('11111111-aaaa-4aaa-8aaa-00000000000a', 120), { engine, waitMs: 20 })
    await submit(params('11111111-aaaa-4aaa-8aaa-00000000000b', 80), { engine, waitMs: 20 })
    await engine.refresh()
    const state = engine.getState()
    eq(state.pending, 2, 'both unsent sales are counted in the pill')
    eq(state.amount, 200, 'and their money is totalled for the sheet')
    eq(state.failed, 0, 'nothing has failed — this is a slow tower, not a rejection')
  },
)

/* ── Records survive the engine that was draining them ──────────────────── */

suite('submit — the app was closed mid-send')

const orphan: OutboxRecord[] = await withEngine(
  () => new Promise<never>(() => {}),
  async (engine) => {
    await submit(params('11111111-aaaa-4aaa-8aaa-00000000000c'), { engine, waitMs: 20 })
    return listOutbox()
  },
)
eq(orphan.length, 1, 'the record outlives the engine, which is the entire point of it')
