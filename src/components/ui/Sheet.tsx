import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/lib/utils'
import { Button, IconButton } from './Button'

/**
 * The bottom sheet — every modal surface in the app.
 *
 * Bottom, not centred. The reachable area of a phone held one-handed is the lower
 * third of the screen, and a shopkeeper's other hand is usually holding goods or
 * change. A centred dialog puts its confirm button where the thumb cannot go.
 *
 * Built on native `<dialog>` rather than a portal and a hand-rolled trap. The
 * platform already gets the hard parts right: focus is trapped, Escape closes,
 * the background becomes inert to both pointer and screen reader, and the sheet
 * renders in the top layer so no `overflow: hidden` ancestor can clip it. Every
 * hand-written trap I have seen leaks focus to the browser chrome on the second
 * Tab; this one cannot.
 */

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Sticky footer, for the action that completes the sheet. */
  footer?: ReactNode
  children: ReactNode
  /** Suppress the backdrop tap and the close button — for a sheet mid-write. */
  dismissible?: boolean
  className?: string
}

export function Sheet({
  open,
  onClose,
  title,
  footer,
  children,
  dismissible = true,
  className,
}: SheetProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // A modal `<dialog>` blocks interaction with the page but not, in every engine,
  // scrolling of it. Behind a sheet the page must hold still.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      // Escape fires `cancel`. Taking it over keeps one code path for closing, so
      // a sheet mid-write can refuse in one place instead of two.
      onCancel={(event) => {
        event.preventDefault()
        if (dismissible) onClose()
      }}
      onClick={(event) => {
        // The dialog element fills the viewport, so a click that lands on it and
        // not on the panel inside is a backdrop tap.
        if (dismissible && event.target === ref.current) onClose()
      }}
      aria-label={title}
      className="m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 outline-none"
    >
      <div className="flex h-full flex-col justify-end">
        <div
          className={cn(
            'bg-surface shadow-sheet animate-sheet-up flex max-h-[92dvh] flex-col rounded-t-[1.25rem]',
            className,
          )}
        >
          {/* The grab handle is decoration with a job: it says "this came from the
              bottom and goes back there", which is most of what a first-time user
              needs to know about a sheet. */}
          <div className="flex items-center gap-2 px-4 pt-3">
            <div className="bg-rule mx-auto h-1 w-10 rounded-pill" aria-hidden="true" />
          </div>

          <div className="flex items-start gap-2 px-4 pb-2 pt-2">
            {title ? (
              <h2 className="text-ink flex-1 text-lg font-semibold">{title}</h2>
            ) : (
              <div className="flex-1" />
            )}
            {dismissible ? (
              <IconButton
                name="close"
                label={t('common.close')}
                size="sm"
                onClick={onClose}
                className="-me-2 -mt-1"
              />
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
            {children}
          </div>

          {footer ? (
            <div className="border-rule bg-surface pb-safe sticky bottom-0 border-t px-4 pt-3">
              {footer}
            </div>
          ) : (
            <div className="pb-safe" />
          )}
        </div>
      </div>
    </dialog>
  )
}

/* ── Confirmation ─────────────────────────────────────────────────────────── */

interface ConfirmRequest {
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  /** Red confirm button. Reserved for deletions and voids. */
  danger?: boolean
}

/**
 * `const ok = await confirm({ … })`.
 *
 * A promise rather than a callback because the call sites are all mid-flow —
 * "void this sale, then refetch, then toast" reads as three sequential steps and
 * should be written as three, not as a pyramid of callbacks.
 *
 * Deliberately local to the component that needs it rather than a global provider.
 * There are perhaps six confirmations in the whole app, and a provider would put a
 * dialog above every screen to serve them.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const { t } = useI18n()
  const [request, setRequest] = useState<ConfirmRequest | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...options, resolve })
      }),
    [],
  )

  const settle = (ok: boolean) => {
    request?.resolve(ok)
    setRequest(null)
  }

  const element = (
    <Sheet
      open={Boolean(request)}
      onClose={() => settle(false)}
      title={request?.title}
      footer={
        <div className="flex gap-3">
          <Button size="lg" variant="ghost" block onClick={() => settle(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="lg"
            variant={request?.danger ? 'danger' : 'primary'}
            block
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      }
    >
      {request?.body ? <p className="text-ink-soft pb-2 text-base">{request.body}</p> : null}
    </Sheet>
  )

  return [confirm, element]
}
