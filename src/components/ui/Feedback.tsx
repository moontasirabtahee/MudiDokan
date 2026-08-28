import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'

/**
 * The states a screen is in when it has nothing to show: loading, empty, or
 * broken. Each one is a designed screen here rather than an afterthought, because
 * on a 2G connection in a shop these are the states the app spends real time in.
 */

/* ── Loading ──────────────────────────────────────────────────────────────── */

/**
 * Skeletons shaped like the content they replace.
 *
 * A centred spinner tells the shopkeeper nothing and makes a slow load feel
 * broken; a list of grey rows says "your products are coming" and makes the same
 * two seconds feel like progress. Only used cache-cold — a cached screen renders
 * its stale data immediately and revalidates behind it.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const { t } = useI18n()
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="card flex items-center gap-3 p-3.5">
          <Skeleton className="h-10 w-10 rounded-card" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  )
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

/**
 * An empty state always offers the next action.
 *
 * "কোনো পণ্য নেই" on its own is a dead end. The same screen with a button that
 * adds the first product is the shortest onboarding this app has, and it is where
 * most shopkeepers will actually start.
 */
export function EmptyState({
  icon = 'box',
  title,
  body,
  action,
  className,
}: {
  icon?: IconName
  title: string
  body?: string
  action?: { label: string; onClick: () => void; icon?: IconName }
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="bg-brand-soft text-brand mb-4 flex h-16 w-16 items-center justify-center rounded-pill">
        <Icon name={icon} size={28} />
      </div>
      <h3 className="text-ink text-lg font-semibold">{title}</h3>
      {body ? <p className="text-ink-soft mt-1.5 max-w-xs text-sm">{body}</p> : null}
      {action ? (
        <Button variant="primary" size="lg" icon={action.icon ?? 'plus'} onClick={action.onClick} className="mt-5">
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Something failed.
 *
 * Retry is always offered, and the technical message is shown below the human one
 * rather than instead of it — a shopkeeper who calls for help needs to be able to
 * read out what went wrong.
 */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message?: string | null
  onRetry?: () => void
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="bg-danger-soft text-danger mb-4 flex h-16 w-16 items-center justify-center rounded-pill">
        <Icon name="alert" size={28} />
      </div>
      <h3 className="text-ink text-lg font-semibold">{t('error.generic')}</h3>
      {message ? <p className="text-ink-faint mt-1.5 max-w-xs break-words text-xs">{message}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="lg" icon="refresh" onClick={onRetry} className="mt-5">
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  )
}

/* ── Badges ───────────────────────────────────────────────────────────────── */

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'bg-paper text-ink-soft ring-rule',
  brand: 'bg-brand-soft text-brand-deep ring-brand/20',
  ok: 'bg-ok-soft text-ok ring-ok/20',
  warn: 'bg-warn-soft text-ink ring-warn/40',
  danger: 'bg-danger-soft text-danger ring-danger/20',
}

/**
 * Status pills.
 *
 * Every tone carries an icon as well as a colour. Red-green colour blindness runs
 * at roughly one man in twelve, and "in stock" versus "out of stock" is exactly
 * the distinction that would otherwise vanish.
 */
export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode
  tone?: Tone
  icon?: IconName
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium ring-1',
        TONES[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  )
}

/* ── Layout helpers ───────────────────────────────────────────────────────── */

/** A titled block. The title is a real heading, so the page outlines correctly. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      {title || action ? (
        <div className="flex items-baseline justify-between gap-3 px-1">
          {title ? <h2 className="text-ink-soft text-sm font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/**
 * A tappable list row.
 *
 * Rendered as a button when it leads somewhere and a plain div when it does not,
 * rather than a div with an onClick — the difference is whether a screen reader
 * announces it as actionable, and whether the keyboard can reach it at all.
 */
export function Row({
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  trailingSub,
  chevron = false,
  className,
}: {
  onClick?: () => void
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  trailingSub?: ReactNode
  chevron?: boolean
  className?: string
}) {
  const inner = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col text-start">
        <span className="text-ink truncate text-base">{title}</span>
        {subtitle ? <span className="text-ink-faint truncate text-xs">{subtitle}</span> : null}
      </span>
      {trailing || trailingSub ? (
        <span className="flex shrink-0 flex-col items-end">
          {trailing ? <span className="tnum text-ink text-base font-medium">{trailing}</span> : null}
          {trailingSub ? <span className="text-ink-faint text-xs">{trailingSub}</span> : null}
        </span>
      ) : null}
      {chevron ? <Icon name="right" size="sm" className="text-ink-faint ms-0.5" /> : null}
    </>
  )

  const shared = cn('flex min-h-tap w-full items-center gap-3 px-3.5 py-2.5', className)
  if (!onClick) return <div className={shared}>{inner}</div>
  return (
    <button type="button" onClick={onClick} className={cn(shared, 'active:bg-brand-soft text-start')}>
      {inner}
    </button>
  )
}

/** Hairline between rows, inset past any leading avatar so the list reads as a group. */
export function Divider({ inset = false }: { inset?: boolean }) {
  return <div className={cn('bg-rule h-px', inset ? 'ms-14' : '')} aria-hidden="true" />
}
