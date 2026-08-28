import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
} from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/lib/utils'
import { Icon, type IconName } from './Icon'

/**
 * Form fields.
 *
 * The label is always visible. Placeholder-as-label is a nice trick for a
 * designer's screenshot and a trap for someone half-literate in the interface
 * language: the moment they start typing, the only clue about what the box is for
 * disappears. Every field here keeps its label above the box, at 15px, in ink.
 *
 * Errors are announced, not merely coloured. Red alone excludes the eight percent
 * of men who cannot reliably see it, and in a khata app red already means
 * something specific — money owed.
 */

export interface FieldProps {
  label?: string
  /** Standing help, always visible. Not a substitute for the label. */
  hint?: string
  /** Resolved message, or a dictionary key. Presence of this puts the field in the error state. */
  error?: string | null
  required?: boolean
  optional?: boolean
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
  className?: string
}

export function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
  className,
}: FieldProps) {
  const { t } = useI18n()
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const invalid = Boolean(error)
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="text-ink flex items-baseline gap-1.5 text-sm font-medium">
          {label}
          {required ? (
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
          {optional ? (
            <span className="text-ink-faint text-xs font-normal">({t('common.optional')})</span>
          ) : null}
        </label>
      ) : null}

      {children({ id, describedBy: describedBy || undefined, invalid })}

      {error ? (
        <p id={errorId} role="alert" className="text-danger flex items-center gap-1.5 text-xs">
          <Icon name="alert" size="sm" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-ink-faint text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/* ── The box itself ───────────────────────────────────────────────────────── */

const BOX = [
  'w-full bg-surface text-ink placeholder:text-ink-faint',
  'rounded-card border border-rule px-3.5',
  'focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none',
  'disabled:bg-paper disabled:text-ink-faint',
].join(' ')

const INVALID = 'border-danger focus:border-danger focus:ring-danger/25'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean
  icon?: IconName
  /** Trailing adornment — a unit, a currency sign, a clear button. */
  suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, icon, suffix, className, ...rest },
  ref,
) {
  const field = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        BOX,
        'h-tap',
        icon && 'ps-11',
        suffix && 'pe-12',
        invalid && INVALID,
        className,
      )}
      {...rest}
    />
  )

  if (!icon && !suffix) return field
  return (
    <div className="relative">
      {icon ? (
        <Icon
          name={icon}
          className="text-ink-faint pointer-events-none absolute inset-y-0 start-3.5 my-auto"
        />
      ) : null}
      {field}
      {suffix ? (
        <div className="text-ink-faint absolute inset-y-0 end-3.5 flex items-center text-sm">
          {suffix}
        </div>
      ) : null}
    </div>
  )
})

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function TextArea({ invalid, className, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(BOX, 'resize-none py-3', invalid && INVALID, className)}
      {...rest}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

/**
 * The platform `<select>`, on purpose.
 *
 * A custom dropdown would look more consistent and behave worse: the native
 * control opens as a full-screen wheel on Android, which is far easier to hit with
 * a thumb than a floating list, and it works without JavaScript having settled.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          BOX,
          'h-tap appearance-none pe-11',
          invalid && INVALID,
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <Icon
        name="down"
        className="text-ink-soft pointer-events-none absolute inset-y-0 end-3.5 my-auto"
      />
    </div>
  )
})

/* ── Switch ───────────────────────────────────────────────────────────────── */

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-tap w-full items-center justify-between gap-4 text-start disabled:opacity-45"
    >
      <span className="flex flex-col">
        <span className="text-ink text-base">{label}</span>
        {hint ? <span className="text-ink-faint text-xs">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-pill transition-colors',
          checked ? 'bg-brand' : 'bg-rule',
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-pill bg-white shadow transition-[inset-inline-start]',
            checked ? 'start-6' : 'start-1',
          )}
        />
      </span>
    </button>
  )
}

/* ── Search ───────────────────────────────────────────────────────────────── */

export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  /**
   * Enter, and therefore a barcode scanner.
   *
   * A cheap USB or Bluetooth scanner is a keyboard: it types the digits and presses
   * return. So the same handler serves "I scanned something" and "I typed a name and
   * meant the first match", which is exactly right — both mean *act on this*.
   */
  onSubmit,
  className,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  autoFocus?: boolean
  onSubmit?: () => void
  className?: string
}) {
  const { t } = useI18n()
  return (
    <Input
      type="search"
      inputMode="search"
      icon="search"
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={
        onSubmit
          ? (event) => {
              if (event.key !== 'Enter') return
              // Stops a wrapping form from reloading the page, which on a scanner
              // that fires return in 20ms is a page reload per item.
              event.preventDefault()
              onSubmit()
            }
          : undefined
      }
      placeholder={placeholder ?? t('common.searchPlaceholder')}
      aria-label={t('common.search')}
      // `enterKeyHint` labels the Android return key "search" instead of "go",
      // and `autoCorrect` off stops the keyboard mangling Bengali product names.
      enterKeyHint="search"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      suffix={
        value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('common.close')}
            className="text-ink-faint -me-1.5 flex h-9 w-9 items-center justify-center"
          >
            <Icon name="close" size="sm" />
          </button>
        ) : null
      }
      className={className}
    />
  )
}
