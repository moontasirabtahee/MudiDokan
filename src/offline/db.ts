import { IDB, SYNC } from '@/lib/constants'
import { newId } from '@/lib/utils'

/**
 * IndexedDB, wrapped in promises, with a memory fallback.
 *
 * Two constraints shaped this file. First, no `idb` package: it is 3 kB for an
 * API this app uses about eight functions' worth of, and every kilobyte here is
 * paid for on a 3G connection. Second, IndexedDB is not actually guaranteed to be
 * there — Firefox private windows throw on `open()`, and locked-down Android
 * WebViews sometimes report the API and then fail every transaction. On a device
 * like that the honest degradation is "works until you close the app", not a
 * white screen, so a failed open falls back to a `Map` and the rest of the
 * application never learns the difference.
 */

export type StoreName = keyof typeof IDB.stores

interface StoreSchema {
  keyPath: string
  indexes: { name: string; keyPath: string }[]
}

const SCHEMA: Record<StoreName, StoreSchema> = {
  outbox: {
    keyPath: 'id',
    indexes: [
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_shop', keyPath: 'shopId' },
      { name: 'by_created', keyPath: 'createdAt' },
    ],
  },
  cache: {
    keyPath: 'key',
    indexes: [
      { name: 'by_shop', keyPath: 'shopId' },
      { name: 'by_saved', keyPath: 'savedAt' },
    ],
  },
  meta: { keyPath: 'key', indexes: [] },
}

/* ── Backends ───────────────────────────────────────────────────────────── */

interface Backend {
  readonly durable: boolean
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  put<T extends object>(store: StoreName, value: T): Promise<void>
  putMany<T extends object>(store: StoreName, values: T[]): Promise<void>
  del(store: StoreName, key: string): Promise<void>
  all<T>(store: StoreName): Promise<T[]>
  byIndex<T>(store: StoreName, index: string, value: string): Promise<T[]>
  clear(store: StoreName): Promise<void>
}

class IdbBackend implements Backend {
  readonly durable = true
  // Spelled out rather than a constructor parameter property: those have runtime
  // semantics, so type-stripping toolchains reject them.
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  private run<T>(
    store: StoreName,
    mode: IDBTransactionMode,
    body: (objectStore: IDBObjectStore) => IDBRequest<T> | null,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let request: IDBRequest<T> | null = null
      const tx = this.db.transaction(IDB.stores[store], mode)
      // Resolve on `oncomplete`, not on the request's `onsuccess`. A write that
      // succeeds inside a transaction that then aborts has not happened, and the
      // outbox depends on knowing the difference.
      tx.oncomplete = () => resolve((request ? request.result : undefined) as T)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      try {
        request = body(tx.objectStore(IDB.stores[store]))
      } catch (error) {
        try {
          tx.abort()
        } catch {
          /* already dead */
        }
        reject(error)
      }
    })
  }

  get<T>(store: StoreName, key: string) {
    return this.run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
  }

  put<T extends object>(store: StoreName, value: T) {
    return this.run<void>(store, 'readwrite', (s) => {
      s.put(value)
      return null
    })
  }

  putMany<T extends object>(store: StoreName, values: T[]) {
    return this.run<void>(store, 'readwrite', (s) => {
      for (const value of values) s.put(value)
      return null
    })
  }

  del(store: StoreName, key: string) {
    return this.run<void>(store, 'readwrite', (s) => {
      s.delete(key)
      return null
    })
  }

  all<T>(store: StoreName) {
    return this.run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
  }

  byIndex<T>(store: StoreName, index: string, value: string) {
    return this.run<T[]>(store, 'readonly', (s) => s.index(index).getAll(value) as IDBRequest<T[]>)
  }

  clear(store: StoreName) {
    return this.run<void>(store, 'readwrite', (s) => {
      s.clear()
      return null
    })
  }
}

class MemoryBackend implements Backend {
  readonly durable = false
  private readonly stores = new Map<StoreName, Map<string, unknown>>()

  private store(name: StoreName): Map<string, unknown> {
    let store = this.stores.get(name)
    if (!store) {
      store = new Map()
      this.stores.set(name, store)
    }
    return store
  }

  private keyOf(store: StoreName, value: object): string {
    return String((value as Record<string, unknown>)[SCHEMA[store].keyPath])
  }

  async get<T>(store: StoreName, key: string) {
    return this.store(store).get(key) as T | undefined
  }

  async put<T extends object>(store: StoreName, value: T) {
    this.store(store).set(this.keyOf(store, value), value)
  }

  async putMany<T extends object>(store: StoreName, values: T[]) {
    for (const value of values) this.store(store).set(this.keyOf(store, value), value)
  }

  async del(store: StoreName, key: string) {
    this.store(store).delete(key)
  }

  async all<T>(store: StoreName) {
    return [...this.store(store).values()] as T[]
  }

  async byIndex<T>(store: StoreName, index: string, value: string) {
    const keyPath = SCHEMA[store].indexes.find((i) => i.name === index)?.keyPath
    if (!keyPath) return []
    return [...this.store(store).values()].filter(
      (row) => (row as Record<string, unknown>)[keyPath] === value,
    ) as T[]
  }

  async clear(store: StoreName) {
    this.store(store).clear()
  }
}

/* ── Opening ────────────────────────────────────────────────────────────── */

let backendPromise: Promise<Backend> | null = null

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(IDB.name, IDB.version)

    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of Object.keys(SCHEMA) as StoreName[]) {
        const schema = SCHEMA[name]
        const store = db.objectStoreNames.contains(IDB.stores[name])
          ? request.transaction!.objectStore(IDB.stores[name])
          : db.createObjectStore(IDB.stores[name], { keyPath: schema.keyPath })
        for (const index of schema.indexes) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath)
          }
        }
      }
    }

    request.onsuccess = () => {
      const db = request.result
      // Another tab running a newer build asked for a version bump. Let go of the
      // connection rather than blocking it, and stop using this handle.
      db.onversionchange = () => {
        db.close()
        backendPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB blocked by another tab'))
  })
}

export function db(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = openIdb()
      .then((idb) => new IdbBackend(idb) as Backend)
      .catch((error) => {
        console.warn('[mudidokan] falling back to in-memory storage:', error)
        return new MemoryBackend() as Backend
      })
  }
  return backendPromise
}

/** False when the fallback is in play — the UI warns that data lives only in RAM. */
export async function isDurable(): Promise<boolean> {
  return (await db()).durable
}

/* ── Generic access ─────────────────────────────────────────────────────── */

export async function getRecord<T>(store: StoreName, key: string): Promise<T | undefined> {
  return (await db()).get<T>(store, key)
}

export async function putRecord<T extends object>(store: StoreName, value: T): Promise<void> {
  return (await db()).put(store, value)
}

export async function putRecords<T extends object>(store: StoreName, values: T[]): Promise<void> {
  if (!values.length) return
  return (await db()).putMany(store, values)
}

export async function deleteRecord(store: StoreName, key: string): Promise<void> {
  return (await db()).del(store, key)
}

export async function allRecords<T>(store: StoreName): Promise<T[]> {
  return (await db()).all<T>(store)
}

export async function recordsByIndex<T>(
  store: StoreName,
  index: string,
  value: string,
): Promise<T[]> {
  return (await db()).byIndex<T>(store, index, value)
}

export async function clearStore(store: StoreName): Promise<void> {
  return (await db()).clear(store)
}

/* ── Read cache ─────────────────────────────────────────────────────────── */

export interface CacheRecord<T = unknown> {
  key: string
  shopId: string
  data: T
  savedAt: number
}

/**
 * Cache keys are `shopId:name`, so one shop's catalogue can never be served to
 * another — the cheapest possible guard against a staff member who works at two
 * shops seeing the wrong stock on a dead network.
 */
export function cacheKey(shopId: string, name: string): string {
  return `${shopId}:${name}`
}

export async function readCache<T>(
  shopId: string,
  name: string,
  maxAgeMs = SYNC.cacheTtlMs,
): Promise<{ data: T; savedAt: number } | null> {
  const row = await getRecord<CacheRecord<T>>('cache', cacheKey(shopId, name))
  if (!row) return null
  if (Date.now() - row.savedAt > maxAgeMs) return null
  return { data: row.data, savedAt: row.savedAt }
}

export async function writeCache<T>(shopId: string, name: string, data: T): Promise<void> {
  await putRecord<CacheRecord<T>>('cache', {
    key: cacheKey(shopId, name),
    shopId,
    data,
    savedAt: Date.now(),
  })
}

export async function dropShopCache(shopId: string): Promise<void> {
  const rows = await recordsByIndex<CacheRecord>('cache', 'by_shop', shopId)
  const backend = await db()
  await Promise.all(rows.map((row) => backend.del('cache', row.key)))
}

export async function invalidateCacheKey(shopId: string, name: string): Promise<void> {
  const backend = await db()
  await backend.del('cache', cacheKey(shopId, name))
}

export async function invalidateCachePrefix(shopId: string, prefix: string): Promise<void> {
  const rows = await recordsByIndex<CacheRecord>('cache', 'by_shop', shopId)
  const backend = await db()
  const matching = rows.filter((row) => row.key.startsWith(`${shopId}:${prefix}`))
  await Promise.all(matching.map((row) => backend.del('cache', row.key)))
}

/** Housekeeping on startup. Stale caches are worse than none — they mislead. */
export async function pruneCache(maxAgeMs = SYNC.cacheTtlMs): Promise<number> {
  const rows = await allRecords<CacheRecord>('cache')
  const cutoff = Date.now() - maxAgeMs
  const stale = rows.filter((row) => row.savedAt < cutoff)
  const backend = await db()
  await Promise.all(stale.map((row) => backend.del('cache', row.key)))
  return stale.length
}

/* ── Meta (a small key/value shelf) ─────────────────────────────────────── */

interface MetaRecord<T = unknown> {
  key: string
  value: T
}

export async function readMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await getRecord<MetaRecord<T>>('meta', key)
  return row ? row.value : fallback
}

export async function writeMeta<T>(key: string, value: T): Promise<void> {
  await putRecord<MetaRecord<T>>('meta', { key, value })
}

let deviceIdPromise: Promise<string> | null = null

/**
 * A stable id for this browser on this device.
 *
 * Outbox entries carry it so that "3 sales waiting" can be attributed to the
 * phone they were rung up on — which matters when a shop has a counter tablet and
 * the owner's phone both selling, and one of them has been offline since Tuesday.
 */
export function deviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      const existing = await readMeta<string | null>('deviceId', null)
      if (existing) return existing
      const created = newId()
      await writeMeta('deviceId', created)
      return created
    })()
  }
  return deviceIdPromise
}

/** Sign-out and shop-switch hygiene. The outbox is deliberately left alone. */
export async function clearCaches(): Promise<void> {
  await clearStore('cache')
}
