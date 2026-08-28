import { type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import type { MemberRole } from '@/lib/database.types'
import { useAuth } from '@/providers/AuthProvider'
import { useShop } from '@/providers/ShopProvider'
import { Spinner } from '@/components/ui/Icon'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'

/**
 * Route guards.
 *
 * Three gates, in the order they have to pass: is there a session, is there a
 * shop, and does this member's role reach the screen. They are separate
 * components rather than one because they fail differently — no session is a
 * redirect to login, no shop is a redirect to onboarding, and the wrong role is
 * not a redirect at all but an explanation.
 */

/**
 * The first paint.
 *
 * A cold start on a cheap handset spends a second or two restoring the session
 * from storage, and a white screen for that second is the difference between "my
 * shop app" and "the browser is broken". Deliberately not a skeleton: there is
 * nothing yet to be shaped like.
 */
export function Splash({ label }: { label?: string }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
      <div className="bg-brand-soft text-brand-deep flex h-16 w-16 items-center justify-center rounded-card text-2xl font-bold">
        {/* The shop's own initial, in Bengali. Two letters of type instead of a
            logo file: one fewer request on a cold, metered connection. */}
        মু
      </div>
      <p className="text-ink-soft text-sm">{label ?? t('app.name')}</p>
      <Spinner className="text-brand" />
    </div>
  )
}

/** Session or nothing. Everything inside the shell needs one. */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <Splash />
  if (status === 'signedOut') {
    // `from` is carried so that a shopkeeper whose token expired mid-khata lands
    // back on the khata after signing in, not on the dashboard.
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

/**
 * A shop, and one that resolved.
 *
 * `empty` is a legitimate, common state — every owner passes through it once, and
 * every invited staff member whose invitation has not been accepted yet sits in it
 * — so it goes to onboarding rather than to an error.
 */
export function RequireShop() {
  const { status, reload, error } = useShop()

  if (status === 'loading') return <Splash />
  if (status === 'empty') return <Navigate to={ROUTES.onboarding} replace />
  if (status === 'error') {
    return (
      <div className="pt-safe">
        <ErrorState message={error} onRetry={() => void reload()} />
      </div>
    )
  }
  return <Outlet />
}

/**
 * Role gate.
 *
 * Explains rather than redirects. A cashier who taps a link to the profit report
 * and lands silently on the dashboard concludes the app is broken; the same
 * cashier told "this is not open to you" learns the shape of his own account. The
 * database enforces the same rule in RLS — this is for the person, not for
 * security.
 */
export function RequireRole({ min, children }: { min: MemberRole; children?: ReactNode }) {
  const { t } = useI18n()
  const { can } = useShop()

  if (!can(min)) {
    return (
      <div className="pt-safe">
        <EmptyState icon="user" title={t('error.permission')} />
      </div>
    )
  }
  return <>{children ?? <Outlet />}</>
}
