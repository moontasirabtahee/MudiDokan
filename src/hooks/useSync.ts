import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  type OutboxRecord,
  discardAll,
  listOutbox,
  retry,
  retryAll,
  discard,
} from '@/offline/outbox'
import { type SyncEvent, type SyncState, getSyncSnapshot, subscribeSync, sync } from '@/offline/sync'

/**
 * React's window onto the sync engine.
 *
 * `useSyncExternalStore` rather than a context: the engine is a module-level
 * singleton that outlives any component, it emits from timers and `online` events
 * rather than from a render, and this hook is read by the status pill in the top
 * bar on every screen. Putting that state in a context would re-render the whole
 * tree every time a record left the queue.
 */

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot)
}

export interface SyncControls extends SyncState {
  /** True when there is anything at all to show the user about the queue. */
  busy: boolean
  sendNow: () => Promise<void>
  retryFailed: () => Promise<void>
  discardFailed: () => Promise<void>
}

export function useSync(): SyncControls {
  const state = useSyncState()

  const sendNow = useCallback(async () => {
    // Forced: the user pressed the button, so `navigator.onLine` does not get a
    // vote. It reports false on some Android builds while the connection is fine.
    await sync.flush({ force: true })
  }, [])

  const retryFailed = useCallback(async () => {
    await retryAll()
    await sync.flush({ force: true })
  }, [])

  const discardFailed = useCallback(async () => {
    await discardAll()
    await sync.refresh()
  }, [])

  return {
    ...state,
    busy: state.pending > 0 || state.failed > 0 || state.status === 'syncing',
    sendNow,
    retryFailed,
    discardFailed,
  }
}

/**
 * Runs `handler` when the engine finishes sending something.
 *
 * This is how a list refetches itself after a queued sale lands: the write went
 * into IndexedDB minutes ago and the server has only just heard about it, so
 * nothing about the moment of landing is visible from a component's own state.
 */
export function useSyncEvent(handler: (event: SyncEvent) => void): void {
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    // The ref indirection means a caller passing an inline arrow does not
    // resubscribe on every render.
    return sync.onEvent((event) => latest.current(event))
  }, [])
}

/** Refetch trigger for data hooks: increments whenever a queued write lands. */
export function useSyncedAt(): number {
  const [at, setAt] = useState(0)
  useSyncEvent(
    useCallback((event: SyncEvent) => {
      if (event.type === 'sent') setAt(Date.now())
    }, []),
  )
  return at
}

export interface OutboxView {
  records: OutboxRecord[]
  loading: boolean
  reload: () => Promise<void>
  retryOne: (id: string) => Promise<void>
  discardOne: (id: string) => Promise<void>
}

/**
 * The pending list, for the screen that shows a shopkeeper exactly what has not
 * reached the server yet.
 *
 * Unscoped by default, deliberately. Someone who works at two shops and has three
 * unsent sales from the other one needs to see them; hiding them behind a shop
 * filter is how they sit there for a week.
 */
export function useOutbox(shopId?: string): OutboxView {
  const [records, setRecords] = useState<OutboxRecord[]>([])
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const rows = await listOutbox(shopId ? { shopId } : {})
    if (!alive.current) return
    setRecords(rows)
    setLoading(false)
  }, [shopId])

  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])

  // Every state change in the engine — sent, failed, backing off — is a change to
  // this list.
  useSyncEvent(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  const retryOne = useCallback(
    async (id: string) => {
      await retry(id)
      await reload()
      await sync.flush({ force: true })
    },
    [reload],
  )

  const discardOne = useCallback(
    async (id: string) => {
      await discard(id)
      await reload()
      await sync.refresh()
    },
    [reload],
  )

  return { records, loading, reload, retryOne, discardOne }
}
