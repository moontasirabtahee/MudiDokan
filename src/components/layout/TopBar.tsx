import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n/I18nProvider'
import { useShop } from '@/providers/ShopProvider'
import { IconButton } from '@/components/ui/Button'
import { SyncStatus } from './SyncStatus'

/**
 * The top bar.
 *
 * Deliberately thin, and deliberately not a title bar. A 5-inch screen cannot
 * spare 56px of chrome to repeat what the lit navigation tab already says, so the
 * screen's heading lives in the page body as an `<h1>` where it scrolls away with
 * the content. What earns permanent space here is the shop's name — the one thing
 * a staff member who works two shops needs constantly — and the sync pill.
 *
 * `back` is a function rather than a boolean because not every back gesture is
 * `navigate(-1)`. A sheet-like screen entered from a deep link has no history to
 * go back to, and the screens that know that pass their own handler.
 */
export function TopBar({
  title,
  back,
  actions,
}: {
  /** Overrides the shop name. Used by screens pushed above a tab. */
  title?: string
  /** `true` for browser history, or a handler for somewhere specific. */
  back?: boolean | (() => void)
  actions?: ReactNode
}) {
  const { t } = useI18n()
  const { shopName } = useShop()
  const navigate = useNavigate()

  const goBack = back === true ? () => navigate(-1) : back || null

  return (
    <header className="no-print border-rule bg-surface/95 pt-safe sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center gap-1.5 px-3">
        {goBack ? (
          <IconButton name="left" label={t('common.back')} size="sm" onClick={goBack} className="-ms-2" />
        ) : null}

        <h1 className="text-ink min-w-0 flex-1 truncate text-base font-semibold">
          {title ?? shopName}
        </h1>

        <SyncStatus />
        {actions}
      </div>
    </header>
  )
}
