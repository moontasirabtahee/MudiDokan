import { createClient, type PostgrestError } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * One client for the whole app.
 *
 * There is no application server in this architecture: PostgREST plus RLS plus
 * the SECURITY DEFINER RPCs *is* the backend. That makes this module the single
 * seam between the UI and the database, which is why the error translation lives
 * here too — a Postgres SQLSTATE should never reach a shopkeeper's screen.
 */

const url =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
  'https://placeholder.supabase.co'
const anonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) ||
  'placeholder-anon-key'

export const supabase = createClient(url, anonKey, {
  auth: {
    // The shop phone is shared and rarely rebooted; nobody should be retyping a
    // password during the evening rush.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'mudidokan.auth',
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-client-info': 'mudidokan-web' },
  },
  realtime: {
    // Low, deliberately. These devices are often on metered 3G and a chatty
    // socket is a real cost to the user.
    params: { eventsPerSecond: 2 },
  },
  db: { schema: 'public' },
})

/* ── Errors ─────────────────────────────────────────────────────────────── */

type Fns = Database['public']['Functions']
export type RpcName = keyof Fns

export type AppErrorKind =
  | 'offline' // no usable connection — safe to queue and retry
  | 'auth' // signed out or token expired
  | 'permission' // RLS or a role assertion said no
  | 'billing' // subscription lapsed, shop is read-only
  | 'validation' // the payload was wrong; retrying will not help
  | 'conflict' // unique violation that was not an idempotent replay
  | 'notfound'
  | 'server'

export class AppError extends Error {
  readonly kind: AppErrorKind
  readonly code?: string
  /** False for validation and permission errors: replaying them just burns battery. */
  readonly retryable: boolean

  constructor(kind: AppErrorKind, message: string, code?: string) {
    super(message)
    this.name = 'AppError'
    this.kind = kind
    this.code = code
    this.retryable = kind === 'offline' || kind === 'server'
  }
}

/**
 * The browser gives us almost nothing to work with when a request dies mid-air:
 * a `TypeError: Failed to fetch` covers a dropped tower, aeroplane mode, DNS
 * failure and CORS alike. All of those mean the same thing to the outbox — keep
 * the write and try later — so they collapse into one kind.
 */
function looksOffline(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('load failed') ||
    message.includes('timeout') ||
    message.includes('aborted')
  )
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  // The message on every error this function builds is a dictionary *key*, not
  // prose. This module sits below `I18nProvider` — the outbox calls it from a
  // service-worker-adjacent context with no React at all — so it cannot know the
  // locale, and an error stored in IndexedDB tonight may well be read in the other
  // language tomorrow. `errorMessage` and `textOrKey` translate at the moment of
  // display; the two branches below that pass `error.message` through untouched are
  // the deliberate exception, because those come from a `RAISE` in one of our own
  // RPCs and are already written for a shopkeeper.
  if (looksOffline(error)) return new AppError('offline', 'error.network')

  if (isPostgrestError(error)) {
    const code = error.code ?? ''

    // Our own RPC assertions raise these three deliberately. The message they
    // carry is already written for a human, so it is passed straight through.
    if (code === '42501') return new AppError('permission', error.message, code)
    if (code === '53400') return new AppError('billing', error.message, code)
    if (code === '22004') return new AppError('validation', error.message, code)

    if (code === 'PGRST301' || code === '401') {
      return new AppError('auth', 'error.signedOut', code)
    }
    // unique_violation. Reaching the client means a real duplicate — a barcode or
    // an SKU — because the client_uuid case is absorbed inside the RPCs.
    if (code === '23505') {
      return new AppError('conflict', 'error.duplicate', code)
    }
    if (code === '23503' || code === '23502' || code === '23514' || code === '22P02') {
      return new AppError('validation', 'error.invalidData', code)
    }
    if (code === 'P0002' || code === 'PGRST116') {
      return new AppError('notfound', error.message || 'error.notFound', code)
    }

    return new AppError('server', error.message || 'error.server', code)
  }

  const message = error instanceof Error ? error.message : 'error.generic'
  return new AppError('server', message)
}

/* ── RPC ────────────────────────────────────────────────────────────────── */

/**
 * Every write in this app goes through here.
 *
 * The `never` return path matters: `.rpc()` resolves rather than rejects on a
 * database error, so a caller that forgets to check `error` gets a silent
 * failure. Throwing an AppError instead means the outbox and the UI share one
 * definition of "this went wrong, and here is whether it is worth retrying".
 */
export async function rpc<K extends RpcName>(
  name: K,
  args: Fns[K]['Args'],
): Promise<Fns[K]['Returns']> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.rpc(name as any, args as any)
    if (error) throw toAppError(error)
    return data as Fns[K]['Returns']
  } catch (error) {
    throw toAppError(error)
  }
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

/**
 * Every read in this app goes through here, for the same reason every write goes
 * through `rpc`.
 *
 * PostgREST resolves rather than rejects on a database error, so
 * `const { data } = await supabase.from(…)` hands back `null` and no complaint
 * when RLS refused the row — which looks exactly like an empty shop. Forty call
 * sites remembering to check `error` is forty chances to ship that bug, so the
 * check lives here and the caller gets a value or an exception.
 */
export async function unwrap<T>(
  query: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<T> {
  const { data, error } = await query
  if (error) throw toAppError(error)
  return data as T
}

/**
 * The same, for a select that embeds related rows.
 *
 * `.select('*, items:sale_items(*)')` is one round trip instead of two, which is
 * worth having on a 3G connection. The cost is that supabase-js infers the result
 * of an embedded select by parsing the select string against the generated
 * `Database` type, and this project's `Database` is hand-written — so that
 * inference ranges from imprecise to a type error, depending on the shape.
 *
 * Rather than scatter casts through the data layer, the shape is stated once at
 * each call site, immediately above the select string it describes, where a
 * reviewer can check the two against each other. Keeping the loose signature in a
 * separate function is deliberate: plain selects keep their real inference, and
 * `unwrapAs` marks the handful of places where a human made the guarantee.
 */
export async function unwrapAs<T>(
  query: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<T> {
  const { data, error } = await query
  if (error) throw toAppError(error)
  return data as T
}

/** Cheap liveness probe. Used by the sync loop before it drains the outbox. */
export async function pingSupabase(timeoutMs = 4000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { apikey: anonKey },
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
