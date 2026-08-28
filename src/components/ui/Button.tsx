import { type ButtonHTMLAttributes, type ReactNode, forwardRef, useRef } from 'react'
import { Icon, type IconName, Spinner } from './Icon'
import { cn } from '@/lib/utils'

/**
 * Buttons.
 *
 * Two decisions here are about the shop rather than about taste.
 *
 * The first is size. Nothing tappable is under 56px, and the primary action on a
 * screen is 64px. The hand using this app is often wet, floury, or holding change,
 * and the phone is often a 5-inch handset with a cracked digitiser. Apple's 44px
 * guidance assumes better conditions than a grocery counter at 7pm.
 *
 * The second is `once`. Every button that spends money or writes a row guards
 * against the double tap: a slow screen invites a second press, and two presses on
 * "সম্পন্ন" must not be two sales. The guard is a 700ms lockout held in a ref, not
 * in state, so it costs no render and cannot be defeated by a re-render mid-tap.
 * It is belt-and-braces over the outbox's `client_uuid`, which already makes the
 * write idempotent — but the outbox protects the *server*, and this protects the
 * shopkeeper from watching two identical sales appear.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warn' | 'outline'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white active:bg-brand-deep shadow-card',
  secondary: 'bg-surface text-ink shadow-card active:bg-brand-soft',
  ghost: 'bg-transparent text-ink-soft active:bg-brand-soft active:text-brand-deep',
  outline: 'bg-surface text-ink border border-rule active:bg-canvas shadow-card',
  danger: 'bg-danger text-white active:brightness-90 shadow-card',
  // Amber on white fails contrast at text weight, so the warn button is a tinted
  // surface with ink text and an amber rule rather than an amber fill.
  warn: 'bg-warn-soft text-ink shadow-card ring-1 ring-warn/50 active:bg-warn/20',
}

const SIZES: Record<Size, string> = {
  sm: 'h-11 px-3.5 text-sm gap-1.5 rounded-card',
  md: 'h-tap px-4 text-base gap-2 rounded-card',
  lg: 'h-tapxl px-5 text-lg gap-2.5 rounded-card font-semibold',
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant
  size?: Size
  /** Spinner in place of the icon; the label stays put so the width does not jump. */
  loading?: boolean
  icon?: IconName
  /** Icon after the label — for "next", "see all", and other forward motion. */
  iconAfter?: IconName
  block?: boolean
  children?: ReactNode
  /**
   * Swallow repeat presses for 700ms. On by default for `primary` and `danger`,
   * because those are the ones that cost money.
   */
  once?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    iconAfter,
    block = false,
    once,
    className,
    disabled,
    onClick,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const lastPress = useRef(0)
  const guard = once ?? (variant === 'primary' || variant === 'danger')

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      onClick={(event) => {
        if (guard) {
          const at = event.timeStamp || Date.now()
          if (at - lastPress.current < 700) {
            event.preventDefault()
            return
          }
          lastPress.current = at
        }
        onClick?.(event)
      }}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        // No hover styles. This is a touch device; `:hover` sticks after a tap on
        // mobile Safari and leaves the last-pressed button looking pressed.
        'transition-[background-color,transform] duration-100 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 'lg' : 'md'} /> : icon ? <Icon name={icon} size={size === 'lg' ? 'lg' : 'md'} /> : null}
      {children}
      {iconAfter && !loading ? <Icon name={iconAfter} size={size === 'lg' ? 'lg' : 'md'} /> : null}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconAfter'> {
  name: IconName
  /** Required: an icon alone tells a screen reader nothing. */
  label: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { name, label, variant = 'ghost', size = 'md', className, loading, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      loading={loading}
      aria-label={label}
      title={label}
      className={cn('aspect-square px-0', size === 'sm' ? 'w-11' : size === 'lg' ? 'w-tapxl' : 'w-tap', className)}
      {...rest}
    >
      {loading ? null : <Icon name={name} size={size === 'sm' ? 'md' : 'lg'} />}
    </Button>
  )
})

/**
 * The floating action button, for the one obvious next thing on a list screen.
 *
 * Sits above the bottom nav, on the trailing side. `pb-safe` is not used here —
 * the offset is against the nav bar, which already clears the home indicator.
 */
export function Fab({
  name,
  label,
  onClick,
  className,
}: {
  name: IconName
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'no-print fixed bottom-[calc(theme(spacing.nav)+var(--safe-b)+0.75rem)] end-4 z-30',
        'bg-brand shadow-lift flex h-tapxl w-tapxl items-center justify-center rounded-pill text-white',
        'active:bg-brand-deep transition-transform duration-100 active:scale-95',
        className,
      )}
    >
      <Icon name={name} size="xl" />
    </button>
  )
}
