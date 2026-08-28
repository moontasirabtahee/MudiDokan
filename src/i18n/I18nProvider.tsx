import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { STORAGE_KEYS } from '@/lib/constants'
import {
  DEFAULT_TZ,
  type Locale,
  type NumberOptions,
  type UnitKey,
  displayName,
  formatAge,
  formatDate,
  formatDateTime,
  formatDayLabel,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  formatPercent,
  formatPhone,
  formatQty,
  formatTime,
  formatWhen,
  isoDay,
  todayIso,
  unitLabel,
  weekdayLabel,
} from '@/lib/format'
import { type StringKey, type TFunction, type TVars, makeT } from './strings'

/**
 * Locale state, plus every formatter already bound to the locale *and* the shop's
 * timezone.
 *
 * The binding is the point. `formatMoney(total, locale)` in two hundred places is
 * two hundred chances to forget the second argument and quietly render Latin
 * digits to a Bengali shopkeeper; `money(total)` cannot be got wrong. The same
 * applies more sharply to dates: a sale at 11pm in Dhaka belongs to *that* day,
 * and every date on screen has to agree about which day that is.
 *
 * Timezone lives here rather than in `ShopProvider` so that there is one
 * formatting hook instead of two. `ShopProvider` pushes the shop's zone down with
 * `setTimeZone` once the active shop resolves.
 */

export interface I18nValue {
  locale: Locale
  timeZone: string
  setLocale: (locale: Locale) => void
  toggleLocale: () => void
  setTimeZone: (timeZone: string) => void

  /** Translate. `t('product.count', { count: 12 })`. */
  t: TFunction

  money: (value: number | null | undefined, options?: NumberOptions & { symbol?: boolean }) => string
  moneyCompact: (value: number) => string
  num: (value: number | null | undefined, options?: NumberOptions) => string
  pct: (value: number | null | undefined, decimals?: number) => string
  qty: (value: number | null | undefined, unit?: UnitKey | string | null) => string
  unit: (unit: UnitKey | string, short?: boolean) => string

  date: (value: Date | string | number | null | undefined, options?: { withYear?: boolean; short?: boolean }) => string
  time: (value: Date | string | number | null | undefined) => string
  dateTime: (value: Date | string | number | null | undefined) => string
  dayLabel: (value: Date | string | number | null | undefined) => string
  when: (value: Date | string | number | null | undefined) => string
  weekday: (value: Date | string | number, short?: boolean) => string
  age: (days: number | null | undefined) => string

  /** Today, in the shop's timezone. The anchor for every report range. */
  today: () => string
  /** Which shop-day a timestamp belongs to. */
  dayOf: (value: Date | string | number) => string

  name: (row: { name: string; name_bn?: string | null } | null | undefined) => string
  phone: (value: string | null | undefined) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function isLocale(value: unknown): value is Locale {
  return value === 'bn' || value === 'en'
}

/**
 * Bengali is the default, not the fallback. A shopkeeper who has never touched
 * settings should see Bengali, and `navigator.language` on a cheap Android
 * handset sold in Bangladesh very often still says `en-US`.
 */
function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.locale)
    if (isLocale(stored)) return stored
  } catch {
    // Private browsing and locked-down WebViews throw on localStorage access.
  }
  return 'bn'
}

export function I18nProvider({
  children,
  initialTimeZone = DEFAULT_TZ,
}: {
  children: ReactNode
  initialTimeZone?: string
}) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale)
  const [timeZone, setTimeZone] = useState(initialTimeZone)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEYS.locale, next)
    } catch {
      // Losing the preference is survivable; crashing the language switch is not.
    }
  }, [])

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'bn' ? 'en' : 'bn')
  }, [locale, setLocale])

  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    // `index.css` keys the Hind Siliguri stack and its slightly taller line-height
    // off this attribute — Bengali conjuncts need the extra room, Latin does not.
    root.dataset.locale = locale
  }, [locale])

  const value = useMemo<I18nValue>(() => {
    const t = makeT(locale)
    return {
      locale,
      timeZone,
      setLocale,
      toggleLocale,
      setTimeZone,
      t,

      money: (v, o) => formatMoney(v, locale, o),
      moneyCompact: (v) => formatMoneyCompact(v, locale),
      num: (v, o) => formatNumber(v, locale, o),
      pct: (v, d) => formatPercent(v, locale, d),
      qty: (v, u) => formatQty(v, u, locale),
      unit: (u, short) => unitLabel(u, locale, short),

      date: (v, o) => formatDate(v, locale, timeZone, o),
      time: (v) => formatTime(v, locale, timeZone),
      dateTime: (v) => formatDateTime(v, locale, timeZone),
      dayLabel: (v) => formatDayLabel(v, locale, timeZone),
      when: (v) => formatWhen(v, locale, timeZone),
      weekday: (v, short) => weekdayLabel(v, locale, timeZone, short),
      age: (d) => formatAge(d, locale),

      today: () => todayIso(timeZone),
      dayOf: (v) => isoDay(v, timeZone),

      name: (row) => displayName(row, locale),
      phone: (v) => formatPhone(v, locale),
    }
  }, [locale, timeZone, setLocale, toggleLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}

/** For components that only need labels. */
export function useT(): TFunction {
  return useI18n().t
}

export type { Locale, StringKey, TVars }
