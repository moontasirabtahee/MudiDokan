import { type ReactNode, forwardRef, useCallback, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { TAKA, parseAmount, roundTo, toBengaliDigits, toLatinDigits } from '@/lib/format'
import { LIMITS } from '@/lib/constants'
import { buzz, cn } from '@/lib/utils'
import { Icon } from './Icon'
import { Input } from './Field'

/**
 * Numeric entry — the most used control in the app, and the one with the most
 * ways to go wrong.
 *
 * Three problems, all specific to this audience.
 *
 * **Bengali digits and `<input type="number">` are mutually exclusive.** The
 * native number input will not accept ১২৫ at all: on a Bengali keyboard the field
 * simply refuses the keystrokes. So these are text inputs with
 * `inputMode="decimal"`, which still summons the numeric keypad, and every value
 * goes through `parseAmount`, which folds Bengali and Arabic-Indic digits down to
 * Latin before `Number()` ever sees them.
 *
 * **A controlled numeric input eats what you are typing.** Round-tripping through
 * `Number` turns "১২." into "১২" and drops the decimal point the instant it is
 * typed, so the field keeps its own draft string while focused and only shows the
 * canonically formatted value once focus leaves. Grouping separators appear on
 * blur, never mid-keystroke, because "১,২" is nonsense while a number is half
 * entered.
 *
 * **Length must not change while typing.** Bengali digits are one code point each,
 * so substituting them in place leaves the caret where the shopkeeper put it. That
 * is the whole reason the draft is localised rather than shown in Latin.
 */

/**
 * Everything the field accepts before parsing: digits, one dot, one leading minus.
 *
 * `maxDecimals` is enforced here rather than on commit, because rounding on commit
 * would let a piece count of "১.৫" quietly become ২. Truncating as it is typed
 * means the shopkeeper sees the field refuse the keystroke and knows why.
 */
function keepNumericChars(raw: string, allowNegative: boolean, maxDecimals: number): string {
  const latin = toLatinDigits(raw).replace(new RegExp(TAKA, 'g'), '').replace(/[।]/g, '.')
  let out = ''
  let fraction = -1 // digits seen after the dot; -1 until a dot appears
  for (const char of latin) {
    if (char >= '0' && char <= '9') {
      if (fraction >= 0) {
        if (fraction >= maxDecimals) continue
        fraction += 1
      }
      out += char
    } else if (char === '.' && fraction < 0 && maxDecimals > 0) {
      out += char
      fraction = 0
    } else if (char === '-' && allowNegative && out.length === 0) out += char
  }
  return out
}

export interface NumericFieldProps {
  value: number | null
  onChange: (next: number | null) => void
  /** Decimal places kept on commit. 0 makes the field integer-only. */
  decimals?: number
  min?: number
  max?: number
  allowNegative?: boolean
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  id?: string
  'aria-describedby'?: string
  'aria-label'?: string
  suffix?: ReactNode
  className?: string
  /** Fires on Enter — the POS uses it to add the line and move on. */
  onSubmit?: () => void
  autoFocus?: boolean
  /** Bigger type for the total on the sell screen. */
  emphasis?: boolean
}

export const NumericField = forwardRef<HTMLInputElement, NumericFieldProps>(function NumericField(
  {
    value,
    onChange,
    decimals = 2,
    min,
    max,
    allowNegative = false,
    placeholder,
    disabled,
    invalid,
    suffix,
    className,
    onSubmit,
    autoFocus,
    emphasis,
    ...aria
  },
  ref,
) {
  const { locale, num } = useI18n()
  const [draft, setDraft] = useState<string | null>(null)

  const localise = useCallback(
    (text: string) => (locale === 'bn' ? toBengaliDigits(text) : text),
    [locale],
  )

  // Focused: whatever is being typed. Blurred: the canonical, grouped form.
  const shown =
    draft !== null ? localise(draft) : value == null ? '' : num(value, { decimals: 'auto' })

  const commit = (raw: string) => {
    const parsed = parseAmount(raw)
    if (parsed == null) {
      onChange(null)
      return
    }
    let next = roundTo(parsed, decimals)
    if (min != null && next < min) next = min
    if (max != null && next > max) next = max
    onChange(next)
  }

  return (
    <Input
      ref={ref}
      type="text"
      // `decimal` rather than `numeric`: it puts the decimal point on the Android
      // keypad, which a shop selling by the kilo needs.
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      enterKeyHint={onSubmit ? 'done' : undefined}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      value={shown}
      disabled={disabled}
      invalid={invalid}
      autoFocus={autoFocus}
      placeholder={placeholder ?? localise('0')}
      onFocus={(event) => {
        // Start the draft ungrouped, from the real value, and select it all: the
        // commonest edit is replacing the number outright, not amending it.
        const input = event.currentTarget
        setDraft(value == null ? '' : String(value))
        requestAnimationFrame(() => input.select())
      }}
      onChange={(event) => {
        const kept = keepNumericChars(event.target.value, allowNegative, decimals)
        setDraft(kept)
        commit(kept)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onSubmit) {
          event.preventDefault()
          event.currentTarget.blur()
          onSubmit()
        }
      }}
      suffix={suffix}
      className={cn(
        'tnum text-end',
        emphasis && 'h-tapxl text-2xl font-semibold',
        className,
      )}
      {...aria}
    />
  )
})

/**
 * Money. The taka sign sits inside the box as a fixed prefix rather than in the
 * label, so it stays visible while the number is being typed and cannot be
 * mistaken for something the shopkeeper is meant to enter.
 */
export const AmountField = forwardRef<
  HTMLInputElement,
  Omit<NumericFieldProps, 'decimals'> & { decimals?: number }
>(function AmountField({ max = LIMITS.maxAmount, className, emphasis, ...rest }, ref) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={cn(
          'text-ink-faint pointer-events-none absolute inset-y-0 start-3.5 z-10 flex items-center',
          emphasis ? 'text-xl' : 'text-base',
        )}
      >
        {TAKA}
      </span>
      <NumericField
        ref={ref}
        decimals={2}
        max={max}
        emphasis={emphasis}
        className={cn('ps-9', className)}
        {...rest}
      />
    </div>
  )
})

/**
 * Quantity, with steppers.
 *
 * The buttons are the point. Most sales are one or two of something, and a
 * shopkeeper mid-rush should not have to hit a keypad at all — but the number stays
 * typable for the case of nine kilos of rice. Weighed goods step by 50g; counted
 * goods step by one and refuse decimals outright, because "১.৫ পিস" is never what
 * anybody meant.
 */
export function QtyField({
  value,
  onChange,
  unit,
  weighted = false,
  step,
  max = LIMITS.maxQty,
  disabled,
  invalid,
  onSubmit,
  id,
  autoFocus,
  className,
}: {
  value: number | null
  onChange: (next: number | null) => void
  unit?: string | null
  weighted?: boolean
  step?: number
  max?: number
  disabled?: boolean
  invalid?: boolean
  onSubmit?: () => void
  id?: string
  autoFocus?: boolean
  className?: string
}) {
  const { t, unit: unitLabel } = useI18n()
  const delta = step ?? (weighted ? 0.05 : 1)
  const held = useRef<ReturnType<typeof setInterval> | null>(null)

  const nudge = (direction: 1 | -1) => {
    const current = value ?? 0
    const next = roundTo(current + direction * delta, weighted ? 3 : 0)
    if (next < 0 || next > max) return
    buzz(8)
    onChange(next === 0 && direction === -1 ? null : next)
  }

  // Press-and-hold to run the count up, for the sack of onions that is 24 pieces.
  const startHold = (direction: 1 | -1) => {
    stopHold()
    held.current = setInterval(() => nudge(direction), 120)
  }
  const stopHold = () => {
    if (held.current) clearInterval(held.current)
    held.current = null
  }

  const stepper = (direction: 1 | -1, label: string) => (
    <button
      type="button"
      disabled={disabled || (direction === -1 && (value ?? 0) <= 0)}
      aria-label={label}
      onClick={() => nudge(direction)}
      onPointerDown={() => startHold(direction)}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      className={cn(
        'bg-paper text-ink border-rule flex h-tap w-tap shrink-0 items-center justify-center border',
        'active:bg-brand-soft disabled:opacity-40',
        direction === -1 ? 'rounded-s-card border-e-0' : 'rounded-e-card border-s-0',
      )}
    >
      <Icon name={direction === 1 ? 'plus' : 'minus'} size="lg" />
    </button>
  )

  return (
    <div className={cn('flex items-stretch', className)}>
      {stepper(-1, t('common.decrease'))}
      <div className="min-w-0 flex-1">
        <NumericField
          id={id}
          value={value}
          onChange={onChange}
          decimals={weighted ? 3 : 0}
          max={max}
          disabled={disabled}
          invalid={invalid}
          onSubmit={onSubmit}
          autoFocus={autoFocus}
          aria-label={t('common.qty')}
          suffix={unit ? <span className="text-xs">{unitLabel(unit)}</span> : undefined}
          className="rounded-none text-center"
        />
      </div>
      {stepper(1, t('common.increase'))}
    </div>
  )
}
