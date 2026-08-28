/**
 * Numbers, money, quantities, dates — in Bengali by default.
 *
 * Everything here is hand-rolled rather than delegated to `Intl.NumberFormat`
 * for one reason: the target device is often a two-year-old budget Android, and
 * the ICU data bundled with its WebView cannot be relied on to include `bn-BD`.
 * A shopkeeper seeing "12,450" where he expects "১২,৪৫০" is a small thing; a
 * shopkeeper seeing "১২,৪৫০" on his phone and "12,450" on the shop tablet is a
 * reason not to trust the app. So digits and grouping are computed here.
 *
 * `Intl.DateTimeFormat` *is* used, but only to resolve a timestamp into
 * year/month/day/hour in the shop's timezone. That part is arithmetic, not
 * localisation, and it is the one thing not worth reimplementing.
 *
 * Note the grouping: South Asian, not Western. ১২,৩৪,৫৬৭ — thousands, then lakhs,
 * then crores. A shopkeeper reads 1,234,567 as wrong.
 */

export type Locale = 'bn' | 'en'

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const

export const TAKA = '৳'

/* ── Digits ─────────────────────────────────────────────────────────────── */

export function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)])
}

/**
 * The inverse. Needed because a shopkeeper typing on a Bengali keyboard will
 * enter ১২৫, and `Number('১২৫')` is NaN. Arabic-Indic digits are folded too —
 * some Android keyboards emit them.
 */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

function localiseDigits(text: string, locale: Locale): string {
  return locale === 'bn' ? toBengaliDigits(text) : text
}

/* ── Numbers ────────────────────────────────────────────────────────────── */

/** 1234567 → "12,34,567". Last three digits, then pairs. */
function groupSouthAsian(digits: string): string {
  if (digits.length <= 3) return digits
  const head = digits.slice(0, -3)
  const tail = digits.slice(-3)
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`
}

export interface NumberOptions {
  /** 'auto' shows decimals only when there are any. Default 'auto'. */
  decimals?: number | 'auto'
  /** Thousands/lakh separators. Default true. */
  group?: boolean
  /** Force a leading + on positive values. Default false. */
  signed?: boolean
}

export function formatNumber(
  value: number | null | undefined,
  locale: Locale = 'bn',
  options: NumberOptions = {},
): string {
  const { decimals = 'auto', group = true, signed = false } = options
  if (value == null || !Number.isFinite(value)) return locale === 'bn' ? '০' : '0'

  const places = decimals === 'auto' ? 2 : decimals
  const rounded = roundTo(value, places)
  const negative = rounded < 0
  const absolute = Math.abs(rounded)

  let text = absolute.toFixed(places)
  if (decimals === 'auto') text = trimTrailingZeros(text)

  const [intPart, fracPart] = text.split('.')
  let out = group ? groupSouthAsian(intPart) : intPart
  if (fracPart) out += `.${fracPart}`

  const sign = negative ? '-' : signed && rounded > 0 ? '+' : ''
  return sign + localiseDigits(out, locale)
}

/**
 * Money. Rounds to paisa, then drops the paisa when it is zero — a grocery deals
 * in whole taka almost always, and "৳১২০.০০" is noise on a 5-inch screen.
 */
export function formatMoney(
  value: number | null | undefined,
  locale: Locale = 'bn',
  options: NumberOptions & { symbol?: boolean } = {},
): string {
  const { symbol = true, ...rest } = options
  const body = formatNumber(value, locale, { decimals: 'auto', ...rest })
  if (!symbol) return body
  // The sign goes outside the symbol: -৳১২০, not ৳-১২০.
  const match = /^([+-])(.*)$/.exec(body)
  return match ? `${match[1]}${TAKA}${match[2]}` : `${TAKA}${body}`
}

/** For chart axes and tight summary cards: ১২.৫ হাজার, ৩.৪ লাখ. */
export function formatMoneyCompact(value: number, locale: Locale = 'bn'): string {
  const abs = Math.abs(value)
  const scale =
    abs >= 1e7
      ? { div: 1e7, bn: 'কোটি', en: 'Cr' }
      : abs >= 1e5
        ? { div: 1e5, bn: 'লাখ', en: 'L' }
        : abs >= 1000
          ? { div: 1000, bn: 'হাজার', en: 'k' }
          : null

  if (!scale) return formatMoney(value, locale)
  const body = formatNumber(value / scale.div, locale, { decimals: 1, group: false })
  const suffix = locale === 'bn' ? scale.bn : scale.en
  return `${TAKA}${body} ${suffix}`.trim()
}

export function formatPercent(
  value: number | null | undefined,
  locale: Locale = 'bn',
  decimals = 1,
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${formatNumber(value, locale, { decimals, group: false })}%`
}

/* ── Quantities and units ───────────────────────────────────────────────── */

export type UnitKey =
  | 'piece'
  | 'kg'
  | 'gram'
  | 'litre'
  | 'ml'
  | 'dozen'
  | 'hali'
  | 'packet'
  | 'sack'
  | 'bundle'

const UNIT_LABELS: Record<UnitKey, { bn: string; en: string; bnShort: string; enShort: string }> = {
  piece: { bn: 'পিস', en: 'piece', bnShort: 'পিস', enShort: 'pc' },
  kg: { bn: 'কেজি', en: 'kilogram', bnShort: 'কেজি', enShort: 'kg' },
  gram: { bn: 'গ্রাম', en: 'gram', bnShort: 'গ্রাম', enShort: 'g' },
  litre: { bn: 'লিটার', en: 'litre', bnShort: 'লিটার', enShort: 'L' },
  ml: { bn: 'মিলিলিটার', en: 'millilitre', bnShort: 'মি.লি.', enShort: 'ml' },
  dozen: { bn: 'ডজন', en: 'dozen', bnShort: 'ডজন', enShort: 'dz' },
  // Four of something. There is no English word for it, and every shopkeeper
  // in Bangladesh sells eggs this way.
  hali: { bn: 'হালি', en: 'hali (4)', bnShort: 'হালি', enShort: 'hali' },
  packet: { bn: 'প্যাকেট', en: 'packet', bnShort: 'প্যাঃ', enShort: 'pkt' },
  sack: { bn: 'বস্তা', en: 'sack', bnShort: 'বস্তা', enShort: 'sack' },
  bundle: { bn: 'বান্ডিল', en: 'bundle', bnShort: 'বাঃ', enShort: 'bdl' },
}

export function unitLabel(unit: UnitKey | string, locale: Locale = 'bn', short = true): string {
  const entry = UNIT_LABELS[unit as UnitKey]
  if (!entry) return unit
  if (locale === 'bn') return short ? entry.bnShort : entry.bn
  return short ? entry.enShort : entry.en
}

/** "১.৫ কেজি", "৩ পিস". Trailing zeros dropped — nobody writes 3.000 kg. */
export function formatQty(
  qty: number | null | undefined,
  unit?: UnitKey | string | null,
  locale: Locale = 'bn',
): string {
  const body = formatNumber(qty ?? 0, locale, { decimals: 'auto', group: false })
  return unit ? `${body} ${unitLabel(unit, locale)}` : body
}

/** Weighed goods get 3 decimals of headroom; counted goods get none. */
export function qtyStep(isWeighted: boolean): number {
  return isWeighted ? 0.05 : 1
}

/* ── Parsing ────────────────────────────────────────────────────────────── */

/**
 * Accepts anything a human might type into an amount field: Bengali digits,
 * grouping commas, a taka sign, spaces, a trailing decimal point mid-typing.
 * Returns null for "not a number yet" so callers can leave the field alone
 * instead of stamping a 0 over what is being typed.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (input == null) return null

  const cleaned = toLatinDigits(String(input))
    .replace(new RegExp(TAKA, 'g'), '')
    .replace(/[,\s_]/g, '')
    .replace(/[।]/g, '.') // Bengali danda, occasionally typed for a decimal point
    .trim()

  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null

  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export function roundTo(value: number, places = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** places
  const scaled = value * factor
  // (1.005 * 100) is 100.49999999999999 in binary floating point, which would
  // round down and quietly lose a paisa. Nudge by one ulp first.
  const nudged = scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled)
  return Math.round(nudged) / factor
}

function trimTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/* ── Dates ──────────────────────────────────────────────────────────────── */

const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
]
const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
// Abbreviations are spelled out rather than sliced: `'অক্টোবর'.slice(0, 3)` is
// 'অক্', which ends on a hasant and renders as a broken cluster.
const BN_MONTHS_SHORT = [
  'জানু',
  'ফেব',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগ',
  'সেপ্ট',
  'অক্টো',
  'নভে',
  'ডিসে',
]
const EN_MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const BN_DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার']
const BN_DAYS_SHORT = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি']
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const DEFAULT_TZ = 'Asia/Dhaka'

export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number
  hour: number // 0-23
  minute: number
  weekday: number // 0 = Sunday
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsCache.get(timeZone)
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      })
    } catch {
      // An unknown zone should not blank out the screen. Fall back to the device.
      formatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      })
    }
    partsCache.set(timeZone, formatter)
  }
  return formatter
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return new Date(value)
  // A bare 'YYYY-MM-DD' is parsed as UTC midnight by the spec, which lands on the
  // previous evening in Dhaka. Anchor it to noon so the calendar date survives
  // any zone shift.
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function zonedParts(
  value: Date | string | number,
  timeZone: string = DEFAULT_TZ,
): ZonedParts | null {
  const date = toDate(value)
  if (!date) return null
  const parts = zonedFormatter(timeZone).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number(pick('hour')) % 24,
    minute: Number(pick('minute')),
    weekday: WEEKDAY_INDEX[pick('weekday')] ?? 0,
  }
}

/** 'YYYY-MM-DD' in the shop's timezone. This is what the report queries take. */
export function isoDay(
  value: Date | string | number = new Date(),
  timeZone: string = DEFAULT_TZ,
): string {
  const parts = zonedParts(value, timeZone)
  if (!parts) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

export function todayIso(timeZone: string = DEFAULT_TZ): string {
  return isoDay(new Date(), timeZone)
}

export function addDays(day: string, delta: number): string {
  const date = toDate(day)
  if (!date) return day
  date.setDate(date.getDate() + delta)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Whole days between two 'YYYY-MM-DD' strings, b − a. */
export function daysBetween(a: string, b: string): number {
  const from = toDate(a)
  const to = toDate(b)
  if (!from || !to) return 0
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

export function formatDate(
  value: Date | string | number | null | undefined,
  locale: Locale = 'bn',
  timeZone: string = DEFAULT_TZ,
  options: { withYear?: boolean; short?: boolean } = {},
): string {
  if (value == null) return '—'
  const parts = zonedParts(value, timeZone)
  if (!parts) return '—'
  const { withYear = false, short = false } = options
  const months = short
    ? locale === 'bn'
      ? BN_MONTHS_SHORT
      : EN_MONTHS_SHORT
    : locale === 'bn'
      ? BN_MONTHS
      : EN_MONTHS
  const month = months[parts.month - 1]
  const day = localiseDigits(String(parts.day), locale)
  const year = withYear ? ` ${localiseDigits(String(parts.year), locale)}` : ''
  return locale === 'bn' ? `${day} ${month}${year}` : `${month} ${day}${withYear ? ',' : ''}${year}`
}

export function weekdayLabel(
  value: Date | string | number,
  locale: Locale = 'bn',
  timeZone: string = DEFAULT_TZ,
  short = true,
): string {
  const parts = zonedParts(value, timeZone)
  if (!parts) return ''
  if (locale === 'bn') return (short ? BN_DAYS_SHORT : BN_DAYS)[parts.weekday]
  const name = EN_DAYS[parts.weekday]
  return short ? name.slice(0, 3) : name
}

/**
 * Bengali does not say AM/PM — it names the part of the day. সকাল ৯:৩০,
 * বিকাল ৪:১৫, রাত ১০:০০. Getting this wrong is the kind of detail that makes an
 * app feel translated rather than written.
 */
function bengaliMeridiem(hour: number): string {
  if (hour < 4) return 'রাত'
  if (hour < 6) return 'ভোর'
  if (hour < 12) return 'সকাল'
  if (hour < 15) return 'দুপুর'
  if (hour < 18) return 'বিকাল'
  if (hour < 20) return 'সন্ধ্যা'
  return 'রাত'
}

export function formatTime(
  value: Date | string | number | null | undefined,
  locale: Locale = 'bn',
  timeZone: string = DEFAULT_TZ,
): string {
  if (value == null) return '—'
  const parts = zonedParts(value, timeZone)
  if (!parts) return '—'
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12
  const minute = String(parts.minute).padStart(2, '0')
  if (locale === 'bn') {
    return `${bengaliMeridiem(parts.hour)} ${toBengaliDigits(`${hour12}:${minute}`)}`
  }
  return `${hour12}:${minute} ${parts.hour < 12 ? 'AM' : 'PM'}`
}

export function formatDateTime(
  value: Date | string | number | null | undefined,
  locale: Locale = 'bn',
  timeZone: string = DEFAULT_TZ,
): string {
  if (value == null) return '—'
  return `${formatDate(value, locale, timeZone)}, ${formatTime(value, locale, timeZone)}`
}

/**
 * Day labels the way they are actually spoken: আজ, গতকাল, then the date. Beyond
 * a week a relative label stops helping — "১১ দিন আগে" makes you do arithmetic,
 * "১৫ আগস্ট" does not.
 */
export function formatDayLabel(
  value: Date | string | number | null | undefined,
  locale: Locale = 'bn',
  timeZone: string = DEFAULT_TZ,
): string {
  if (value == null) return '—'
  const day = isoDay(value, timeZone)
  const diff = daysBetween(day, todayIso(timeZone))

  if (diff === 0) return locale === 'bn' ? 'আজ' : 'Today'
  if (diff === 1) return locale === 'bn' ? 'গতকাল' : 'Yesterday'
  if (diff === -1) return locale === 'bn' ? 'আগামীকাল' : 'Tomorrow'
  if (diff > 1 && diff <= 6) {
    return locale === 'bn'
      ? `${toBengaliDigits(String(diff))} দিন আগে`
      : `${diff} days ago`
  }
  if (diff < -1 && diff >= -6) {
    return locale === 'bn'
      ? `${toBengaliDigits(String(-diff))} দিন পরে`
      : `in ${-diff} days`
  }
  return formatDate(value, locale, timeZone, {
    withYear: Math.abs(diff) > 300,
  })
}

/** "আজ, বিকাল ৪:১৫" — used on receipts and activity rows. */
export function formatWhen(
  value: Date | string | number | null | undefined,
  locale: Locale = 'bn',
  timeZone: string = DEFAULT_TZ,
): string {
  if (value == null) return '—'
  return `${formatDayLabel(value, locale, timeZone)}, ${formatTime(value, locale, timeZone)}`
}

/** Age of a due, in the words a shopkeeper would use chasing it. */
export function formatAge(days: number | null | undefined, locale: Locale = 'bn'): string {
  if (days == null || days < 0) return '—'
  if (days === 0) return locale === 'bn' ? 'আজকের' : 'today'
  if (days < 30) {
    return locale === 'bn' ? `${toBengaliDigits(String(days))} দিন` : `${days}d`
  }
  const months = Math.floor(days / 30)
  return locale === 'bn' ? `${toBengaliDigits(String(months))} মাস` : `${months}mo`
}

/* ── Text ───────────────────────────────────────────────────────────────── */

/** Bengali has no case, so this is a first-grapheme slice rather than an uppercase. */
export function initials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  const words = trimmed.split(/\s+/).slice(0, 2)
  return words.map((word) => Array.from(word)[0] ?? '').join('')
}

/** 01712345678 → ০১৭১২-৩৪৫৬৭৮. Anything unexpected passes through untouched. */
export function formatPhone(phone: string | null | undefined, locale: Locale = 'bn'): string {
  if (!phone) return '—'
  const digits = toLatinDigits(phone).replace(/\D/g, '')
  const grouped = digits.length === 11 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : phone
  return localiseDigits(grouped, locale)
}

/** For tel: links — always Latin digits, always +880. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = toLatinDigits(phone).replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('0')) return `tel:+880${digits.slice(1)}`
  if (digits.length === 13 && digits.startsWith('880')) return `tel:+${digits}`
  return digits ? `tel:${digits}` : null
}

/** Localised name with a graceful fallback, used everywhere a product is shown. */
export function displayName(
  row: { name: string; name_bn?: string | null } | null | undefined,
  locale: Locale = 'bn',
): string {
  if (!row) return '—'
  if (locale === 'bn') return row.name_bn?.trim() || row.name
  return row.name
}
