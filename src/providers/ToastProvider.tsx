import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { type StringKey, type TVars, errorMessage } from '@/i18n/strings'
import { buzz, cn, newId } from '@/lib/utils'

/**
 * Transient feedback.
 *
 * Must sit inside `<I18nProvider>`: almost every toast is a dictionary key, and
 * error toasts need the locale to decide between our own Bengali message from a
 * `RAISE` in an RPC and a generic label for a PostgREST failure.
 *
 * Toasts drop in from the top rather than rising from the bottom. The bottom of
 * the screen belongs to the nav bar and, during a sale, to the keyboard.
 */

export type ToastKind = 'success' | 'error' | 'warn' | 'info'

export interface ToastAction {
  label: string
  onPress: () => void
}

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  action?: ToastAction
}

export interface ToastOptions {
  kind?: ToastKind
  action?: ToastAction
  /** Milliseconds. 0 keeps it up until dismissed or acted on. */
  ms?: number
}

export interface ToastApi {
  /** A message already in the right language. */
  show: (message: string, options?: ToastOptions) => string
  /** The common case: a dictionary key. */
  say: (key: StringKey, vars?: TVars, options?: ToastOptions) => string
  /** Anything thrown. Picks the message and the tone from the error's kind. */
  fail: (error: unknown, fallback?: StringKey) => string
  dismiss: (id: string) => void
  clear: () => void
}

const DEFAULT_MS: Record<ToastKind, number> = {
  // Long enough to read a Bengali sentence at arm's length, short enough not to
  // sit over the next sale.
  success: 2600,
  info: 3000,
  warn: 4500,
  error: 5500,
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n()
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    setToasts([])
  }, [])

  useEffect(() => clear, [clear])

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const kind = options.kind ?? 'info'
      const id = newId()
      const toast: Toast = { id, kind, message, action: options.action }
      // Three at a time. A stack taller than that is covering the screen the
      // shopkeeper is trying to use.
      setToasts((current) => [...current.slice(-2), toast])

      if (kind === 'error') buzz([18, 40, 18])
      else if (kind === 'success') buzz(10)

      const ms = options.ms ?? (options.action ? 0 : DEFAULT_MS[kind])
      if (ms > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ms),
        )
      }
      return id
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(() => {
    const say: ToastApi['say'] = (key, vars, options) => show(t(key, vars), options)

    return {
      show,
      say,
      fail: (error, fallback) => {
        const candidate = error as { kind?: unknown } | null
        if (candidate?.kind === 'offline') {
          // Not an error the shopkeeper caused, and not one that lost any work:
          // the write is in the outbox and will go out on its own.
          return say('sync.offlineBanner', undefined, { kind: 'warn' })
        }
        return show(errorMessage(locale, error, fallback), { kind: 'error' })
      },
      dismiss,
      clear,
    }
  }, [show, t, locale, dismiss, clear])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

const TONE: Record<ToastKind, string> = {
  success: 'bg-ok text-white',
  error: 'bg-danger text-white',
  warn: 'bg-warn text-ink',
  info: 'bg-ink text-white',
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}) {
  if (!toasts.length) return null
  return (
    <div
      // `polite`, not `assertive`: a screen reader should finish the current line
      // before announcing that a sale saved.
      aria-live="polite"
      aria-atomic="false"
      className="no-print pt-safe pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-3 pt-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'animate-toast-in shadow-lift pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-card px-4 py-3 text-sm',
            TONE[toast.kind],
          )}
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onPress()
                onDismiss(toast.id)
              }}
              className="shrink-0 rounded-pill bg-white/20 px-3 py-1 font-medium"
            >
              {toast.action.label}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Close"
              className="shrink-0 text-lg leading-none opacity-70"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
