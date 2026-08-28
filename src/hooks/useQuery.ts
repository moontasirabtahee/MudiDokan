import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessage } from '@/i18n/strings'
import { SYNC } from '@/lib/constants'
import { readCache, writeCache } from '@/offline/db'
import { useShop } from '@/providers/ShopProvider'
import { useSyncEvent } from './useSync'

/**
 * Cache-first reads.
 *
 * The shape is stale-while-revalidate: paint whatever is on the device, then go
 * and check. On a metered 3G connection in a shop that is the difference between a
 * product list appearing instantly and a shopkeeper watching a spinner while a
 * customer waits — and when the tower is down, the cache simply *is* the app.
 *
 * Deliberately not React Query. That library is excellent and ~13 kB gzipped for a
 * global cache, dedup and window-focus machinery this app mostly does not use: its
 * screens do not overlap, and its persistence layer already exists in
 * `offline/db.ts` because the same data has to survive being offline, not merely a
 * remount. What is left is small enough to read in one sitting, which matters more
 * here than generality.
 *
 * Three rules earn their keep:
 *
 *  - A failed refresh never clears the screen. Replacing a full product list with
 *    an error page is a downgrade from paper. The stale rows stay, and `error` is
 *    offered for the screen to mention quietly.
 *  - Every fetch is stamped with a run id, so a slow first response cannot land on
 *    top of a fast second one. Without it, switching shops twice quickly shows the
 *    first shop's stock under the second shop's name.
 *  - A queued write reaching the server refetches. The write happened minutes ago
 *    in IndexedDB and nothing about the moment it lands is visible from here.
 */

export interface QueryOptions {
  /** Read from and write to the on-device cache. Off for searches and one-offs. */
  cache?: boolean
  /** How long a cached copy is served without a refresh. */
  staleMs?: number
  /** False to hold off entirely — a detail query whose id is not known yet. */
  enabled?: boolean
  /** Refetch when a queued write reaches the server. */
  onSync?: boolean
}

export interface QueryResult<T> {
  data: T | null
  /** Translated, ready to show. Null when the last attempt succeeded. */
  error: string | null
  /** Nothing to show yet — the only state that warrants a skeleton. */
  loading: boolean
  /** Something is on screen and a refresh is in flight. */
  refreshing: boolean
  /** When the data on screen was fetched. Drives "as of ..." on stale screens. */
  savedAt: number | null
  refetch: () => Promise<void>
}

interface Snapshot<T> {
  data: T | null
  savedAt: number | null
  /** Kept raw, translated on read: a language switch must not refetch every screen. */
  error: unknown
  loading: boolean
  refreshing: boolean
}

/**
 * `name` is both the cache slot and the dependency key, so anything the fetcher
 * closes over has to appear in it — `products:low` and `party:${partyId}`. One
 * string instead of a dependency array means a screen cannot cache two different
 * results under one key, which is the failure mode that produces another
 * customer's ledger on screen.
 */
export function useQuery<T>(
  name: string | null,
  fetcher: (shopId: string) => Promise<T>,
  options: QueryOptions = {},
): QueryResult<T> {
  const { cache = true, staleMs = SYNC.staleMs, enabled = true, onSync = true } = options
  const { locale } = useI18n()
  const { shopId } = useShop()

  const active = enabled && Boolean(name) && Boolean(shopId)

  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({
    data: null,
    savedAt: null,
    error: null,
    loading: active,
    refreshing: false,
  }))

  // The fetcher is nearly always an inline arrow, so its identity changes every
  // render. Holding it in a ref keeps `load` stable and the effect quiet.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const runRef = useRef(0)
  const aliveRef = useRef(true)

  const load = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!name || !shopId) return
      const run = ++runRef.current
      const mine = () => runRef.current === run && aliveRef.current

      if (cache) {
        const hit = await readCache<T>(shopId, name)
        if (hit && mine()) {
          const isFresh = !force && Date.now() - hit.savedAt < staleMs
          setSnapshot({
            data: hit.data,
            savedAt: hit.savedAt,
            error: null,
            loading: false,
            refreshing: !isFresh,
          })
          if (isFresh) {
            return
          }
        }
      }

      if (mine()) {
        setSnapshot((previous) => ({
          ...previous,
          loading: previous.data == null,
          refreshing: previous.data != null,
        }))
      }

      try {
        const data = await fetcherRef.current(shopId)
        if (!mine()) return
        setSnapshot({ data, savedAt: Date.now(), error: null, loading: false, refreshing: false })
        if (cache) void writeCache(shopId, name, data)
      } catch (error) {
        if (!mine()) return
        setSnapshot((previous) => ({ ...previous, error, loading: false, refreshing: false }))
      }
    },
    [cache, name, shopId, staleMs],
  )

  useEffect(() => {
    aliveRef.current = true
    if (!active) {
      setSnapshot({ data: null, savedAt: null, error: null, loading: false, refreshing: false })
      return
    }
    void load()
    return () => {
      aliveRef.current = false
    }
  }, [active, load])

  useSyncEvent(
    useCallback(
      (event) => {
        if (onSync && active && event.type === 'sent') void load({ force: true })
      },
      [active, load, onSync],
    ),
  )

  // Coming back to a phone that has been in a pocket, or reconnecting, is the
  // moment stale data is most likely and least expected. `load` without `force`
  // still respects `staleMs`, so this costs nothing on a quick glance away.
  useEffect(() => {
    if (!active) return
    const wake = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [active, load])

  const refetch = useCallback(() => load({ force: true }), [load])

  const error = useMemo(
    () => (snapshot.error ? errorMessage(locale, snapshot.error) : null),
    [snapshot.error, locale],
  )

  return {
    data: snapshot.data,
    error,
    loading: snapshot.loading,
    refreshing: snapshot.refreshing,
    savedAt: snapshot.savedAt,
    refetch,
  }
}

/**
 * The list flavour: `[]` instead of `null` before the first response, so screens
 * can map without a null check and an empty shop and an unloaded one look the same
 * to the renderer — which they should, because both show the empty state.
 */
export function useQueryList<T>(
  name: string | null,
  fetcher: (shopId: string) => Promise<T[]>,
  options: QueryOptions = {},
): QueryResult<T[]> & { rows: T[] } {
  const result = useQuery<T[]>(name, fetcher, options)
  return { ...result, rows: result.data ?? [] }
}
