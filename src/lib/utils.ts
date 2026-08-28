import { toLatinDigits } from './format'

/**
 * Small helpers with no home of their own.
 *
 * Deliberately dependency-free. `clsx`, `nanoid`, `lodash.debounce` and
 * `tailwind-merge` between them are about 12 kB gzipped for maybe sixty lines of
 * behaviour, and this app is downloaded over 3G by people paying for the data.
 */

/* ── Class names ────────────────────────────────────────────────────────── */

type ClassValue = string | number | false | null | undefined | ClassValue[]

/** Joins conditional class names. `cn('p-2', isActive && 'bg-brand')`. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = []
  const walk = (value: ClassValue) => {
    if (!value) return
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    out.push(String(value))
  }
  values.forEach(walk)
  return out.join(' ')
}

/* ── Identity ───────────────────────────────────────────────────────────── */

/**
 * The idempotency key for every offline write. The whole "queue it now, send it
 * whenever" design rests on this being unique per intent, so the fallbacks are
 * real fallbacks, not decoration: `crypto.randomUUID` needs a secure context and
 * did not land in Android WebView until 92, and some of these phones are older
 * than that.
 */
export function newId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined

  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()

  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // Last resort. Weak, but a colliding UUID only ever costs a duplicate-detected
  // no-op on the server, whereas failing to produce one costs the sale.
  const rand = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0')
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-8${rand().slice(1)}-${rand()}${rand()}${rand()}`
}

/* ── Search ─────────────────────────────────────────────────────────────── */

// Combining marks stripped before comparison: Latin accents, and — the one that
// matters here — the Bengali nukta, U+09BC.
const COMBINING = /[̀-়ͯ]/g
// Zero-width space, ZWNJ, ZWJ, BOM. Phone keyboards sprinkle these into Bengali.
const INVISIBLE = /[​-‍﻿]/g
// Note `\p{M}`: Bengali vowel signs, hasant and chandrabindu are *marks*, not
// letters. Leaving them out of this keep-set shreds every Bengali word into bare
// consonants — মিনিকেট becomes "ম ন ক ট" — and search stops working entirely.
const NON_ALNUM = /[^\p{L}\p{N}\p{M}]+/gu

/**
 * Folds a string down to something two spellings can agree on.
 *
 * Bengali needs more care than English here. ড়, ঢ় and য় are Unicode composition
 * exclusions, so NFC will *not* recompose them: the same word typed on two
 * keyboards can differ byte-for-byte while looking identical. Decomposing and
 * then dropping the nukta sidesteps that, and has a useful side effect — ড় and ড
 * come to match each other, which is what someone hunting for a product wants.
 * Digits fold to Latin too, so typing ৫০০ finds "500g".
 */
export function foldForSearch(input: string | null | undefined): string {
  if (!input) return ''
  return toLatinDigits(input)
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(NON_ALNUM, ' ')
    .trim()
}

/**
 * Every whitespace-separated token in the query must appear somewhere in the
 * haystack. Word-order-free matching matters because "চাল মিনিকেট" and
 * "মিনিকেট চাল" are the same product to the person typing.
 */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = foldForSearch(query)
  if (!needle) return true
  const haystack = fields.map(foldForSearch).join(' ')
  return needle.split(' ').every((token) => haystack.includes(token))
}

/** Ranks an exact or prefix hit above a mid-string one, for ordering results. */
export function searchRank(
  query: string,
  primary: string,
  ...rest: (string | null | undefined)[]
): number {
  const needle = foldForSearch(query)
  if (!needle) return 0
  const first = foldForSearch(primary)
  if (first === needle) return 0
  if (first.startsWith(needle)) return 1
  if (first.includes(needle)) return 2
  return foldForSearch(rest.join(' ')).includes(needle) ? 3 : 4
}

/* ── Timing ─────────────────────────────────────────────────────────────── */

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs = 250,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), waitMs)
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return wrapped
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ── Arrays and objects ─────────────────────────────────────────────────── */

export function sum<T>(rows: readonly T[], pick: (row: T) => number | null | undefined): number {
  let total = 0
  for (const row of rows) total += pick(row) ?? 0
  return total
}

export function groupBy<T, K extends string>(
  rows: readonly T[],
  key: (row: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const row of rows) {
    const bucket = key(row)
    ;(out[bucket] ??= []).push(row)
  }
  return out
}

export function uniqueBy<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    const id = key(row)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(row)
  }
  return out
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Drops undefined keys, so a partial payload cannot overwrite a value with null. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key as keyof T] = value as T[keyof T]
  }
  return out
}

export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/* ── Device ─────────────────────────────────────────────────────────────── */

/** A short, stable label so the outbox can record where a queued write came from. */
export function deviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS'
  if (/windows/i.test(ua)) return 'Windows'
  if (/mac os/i.test(ua)) return 'Mac'
  return 'Web'
}

/**
 * A quick haptic tick on a completed sale. Cheap, and on a noisy shop floor it
 * confirms the tap landed better than any animation does.
 */
export function buzz(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* Unsupported, and not important enough to report. */
  }
}

/* ── Phone helpers ───────────────────────────────────────────────────────── */

/** Extracts Latin digits from phone input. */
export function cleanPhoneForDialing(phone: string | null | undefined): string {
  if (!phone) return ''
  return toLatinDigits(phone).replace(/\D/g, '')
}

/** Validates whether input is a valid 11-digit Bangladeshi mobile number (013..019) or with +880. */
export function isBangladeshiPhone(phone: string | null | undefined): boolean {
  if (!phone) return false
  const digits = cleanPhoneForDialing(phone)
  if (digits.length === 11 && /^01[3-9]\d{8}$/.test(digits)) return true
  if (digits.length === 13 && /^8801[3-9]\d{8}$/.test(digits)) return true
  return false
}
