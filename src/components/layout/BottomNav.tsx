import { NavLink } from 'react-router-dom'
import { useI18n } from '@/i18n/I18nProvider'
import { NAV_ITEMS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { Icon, type IconName } from '@/components/ui/Icon'

/**
 * The bottom navigation.
 *
 * Five destinations, fixed to the bottom, with labels. Icon-only navigation is a
 * literacy test disguised as minimalism: a shopkeeper who is not sure whether the
 * box means "products" or "stock" will not tap it, and this app cannot afford an
 * untapped tab. The labels are the shortest word for each idea in Bengali, which
 * is why they fit.
 *
 * `end` is set on the home link alone. Without it, `/` matches every route and the
 * home tab stays lit on all five screens.
 */
export function BottomNav() {
  const { t, locale } = useI18n()

  return (
    <nav
      aria-label={t('nav.main')}
      className="no-print border-rule bg-surface pb-safe fixed inset-x-0 bottom-0 z-30 border-t"
    >
      <ul className="mx-auto flex h-nav max-w-md items-stretch">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex h-full flex-col items-center justify-center gap-0.5 pt-1',
                  isActive ? 'text-brand' : 'text-ink-faint',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The active pill, not a filled icon variant: one glyph per
                      destination keeps the set to five paths instead of ten. */}
                  <span
                    className={cn(
                      'flex h-8 w-12 items-center justify-center rounded-pill transition-colors',
                      isActive && 'bg-brand-soft',
                    )}
                  >
                    <Icon name={item.icon as IconName} size="lg" />
                  </span>
                  <span className={cn('text-xs', isActive && 'font-semibold')}>
                    {locale === 'bn' ? item.bn : item.en}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
