import { cn } from '@/lib/utils'
import { Icon, type IconName } from './Icon'

/**
 * Segmented control — the range switcher on reports, the tabs on the khata screen.
 *
 * A real `radiogroup`, so arrow keys move between options and a screen reader
 * announces "2 of 4 selected". Tabs built from buttons are the commonest
 * accessibility failure in dashboards and it costs nothing to avoid.
 *
 * Scrolls horizontally rather than wrapping or shrinking. Four Bengali range
 * labels do not fit across a 5-inch screen, and a squeezed segment with clipped
 * text is worse than one the shopkeeper has to swipe.
 */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
  /** A count or total beside the label — "বাকি ১২". */
  badge?: string
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly SegmentedOption<T>[]
  /** Group label for assistive tech. Not rendered. */
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('scroll-x bg-paper ring-rule flex gap-1 rounded-pill p-1 ring-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill font-medium transition-colors',
              size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-base',
              active ? 'bg-surface text-brand-deep shadow-card' : 'text-ink-soft active:bg-brand-soft',
            )}
          >
            {option.icon ? <Icon name={option.icon} size="sm" /> : null}
            {option.label}
            {option.badge ? (
              <span className={cn('tnum text-xs', active ? 'text-brand' : 'text-ink-faint')}>
                {option.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
