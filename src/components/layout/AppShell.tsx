import { type ReactNode, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Banners } from './Banners'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'

/**
 * The frame every signed-in screen sits in.
 *
 * The shell owns two things only: the bottom navigation, and resetting the scroll
 * position on navigation. Everything above the content — the bar, the banners — is
 * composed by the screen itself through `Screen` below.
 *
 * That split is deliberate. The alternative, a shell that renders the top bar and
 * learns each screen's title through a context or a route handle, means the title
 * arrives one render after the screen does and the bar flickers the old title on
 * every navigation. Letting the screen render its own header costs one line per
 * screen and the bar is simply always right.
 */
export function AppShell() {
  const { pathname } = useLocation()

  // React Router does not restore or reset scroll. Without this, tapping a product
  // in a list scrolled halfway down opens its detail screen scrolled halfway down.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-dvh">
      <Outlet />
      <BottomNav />
    </div>
  )
}

/**
 * One screen: header, standing notices, content, and optionally a sticky action
 * bar above the navigation.
 *
 * `<header>` and `<main>` are real landmarks here rather than divs, so a screen
 * reader user can jump straight to the content instead of walking the bar on every
 * navigation.
 */
export function Screen({
  title,
  back,
  actions,
  footer,
  children,
  /** Turn off the horizontal gutter for screens that manage their own — a full-bleed list. */
  padded = true,
  className,
}: {
  title?: string
  back?: boolean | (() => void)
  actions?: ReactNode
  /** Sticky bar above the bottom nav, for the action that completes the screen. */
  footer?: ReactNode
  children: ReactNode
  padded?: boolean
  className?: string
}) {
  return (
    <>
      <TopBar title={title} back={back} actions={actions} />
      <Banners />
      <main
        className={cn(
          'mx-auto w-full max-w-lg',
          padded && 'px-4 pt-3.5',
          footer ? 'pb-action' : 'pb-nav',
          className,
        )}
      >
        {children}
      </main>
      {footer ? <ActionBar>{footer}</ActionBar> : null}
    </>
  )
}

/**
 * The sticky action bar.
 *
 * Sits directly above the bottom navigation rather than replacing it. Hiding the
 * navigation during a sale would be the tidier composition and the wrong call: a
 * cashier who has half-built a cart and needs to check a price has to be able to
 * leave and come back, and a screen with no way out is where people force-quit the
 * app — which, on this app, means abandoning the cart.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'no-print border-rule bg-surface/95 fixed inset-x-0 z-20 border-t px-3 py-3 backdrop-blur',
        'bottom-[calc(theme(spacing.nav)+var(--safe-b))]',
      )}
    >
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  )
}
