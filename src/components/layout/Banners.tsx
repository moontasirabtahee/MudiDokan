import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n/I18nProvider'
import { useSyncState } from '@/hooks/useSync'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { Icon, type IconName } from '@/components/ui/Icon'

/**
 * The standing notices: no internet, nowhere to store the queue, subscription
 * lapsed.
 *
 * These scroll away with the content rather than sticking under the top bar. The
 * sync pill in the bar is the permanent reminder and it costs nothing; a banner
 * pinned to the top of a 5-inch screen costs a row of the product list on every
 * screen, all day, for something the shopkeeper read once.
 *
 * Only three conditions qualify, and each one changes what he can do:
 *
 *  - Offline. Stated plainly and immediately followed by the reassurance, because
 *    the first thing a new user assumes is that his sale did not save.
 *  - No durable storage. The rare and serious one — IndexedDB refused, so the
 *    queue is in memory and closing the tab loses it.
 *  - Read-only, or a trial about to end. Money, and the only banner with a button.
 */

/** A trial gets its warning in the last stretch, not from day one. */
const TRIAL_NAG_DAYS = 3

type Tone = 'info' | 'warn' | 'danger'

const TONES: Record<Tone, string> = {
  info: 'bg-brand-soft text-brand-deep',
  warn: 'bg-warn-soft text-ink',
  danger: 'bg-danger-soft text-danger',
}

function Banner({
  tone,
  icon,
  children,
  action,
}: {
  tone: Tone
  icon: IconName
  children: ReactNode
  action?: { to: string; label: string }
}) {
  return (
    <div
      // `status`, not `alert`: these appear as a consequence of the world changing,
      // not of something the shopkeeper just did, and an assertive live region
      // would cut across whatever he is reading.
      role="status"
      className={cn('no-print flex items-center gap-2 px-3.5 py-2 text-xs', TONES[tone])}
    >
      <Icon name={icon} size="sm" className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action ? (
        <Link
          to={action.to}
          className="shrink-0 rounded-pill bg-white/70 px-2.5 py-1 font-semibold underline-offset-2"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  )
}

export function Banners() {
  const { t } = useI18n()
  // The state, not the controls: this component never flushes the queue, and
  // `useSync` would hand it three callbacks it has no use for.
  const { online, durable } = useSyncState()
  const { canWrite, subStatus, trialDaysLeft } = useShop()

  const trialEnding = canWrite && subStatus === 'trialing' && trialDaysLeft <= TRIAL_NAG_DAYS

  return (
    <>
      {!online ? (
        <Banner tone="warn" icon="cloudOff">
          {t('sync.offlineBanner')}
        </Banner>
      ) : null}

      {!durable ? (
        <Banner tone="danger" icon="alert">
          {t('sync.notDurable')}
        </Banner>
      ) : null}

      {!canWrite ? (
        <Banner
          tone="danger"
          icon="alert"
          action={{ to: ROUTES.billing, label: t('billing.renew') }}
        >
          {subStatus === 'past_due' ? t('billing.pastDue') : t('billing.readOnly')}
        </Banner>
      ) : trialEnding ? (
        <Banner tone="info" icon="clock" action={{ to: ROUTES.billing, label: t('billing.renew') }}>
          {t('billing.trialLeft', { days: trialDaysLeft })}
        </Banner>
      ) : null}
    </>
  )
}
