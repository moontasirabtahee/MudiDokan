import type { AppErrorKind } from '@/lib/supabase'
import { type Locale, formatNumber } from '@/lib/format'
import { bn, type Dict, type StringKey } from './bn'
import { en } from './en'

/**
 * Translation lookup and placeholder substitution.
 *
 * Deliberately not a library. `i18next` is 40 kB before plugins and this app
 * needs exactly two things: a keyed lookup and `{name}` substitution. What it
 * does need, and what no off-the-shelf library gets right for Bengali, is
 * localising the *numbers* inside the interpolated strings — '{count}টি পণ্য'
 * with count=5 has to read '৫টি পণ্য', not '5টি পণ্য'. That happens here so no
 * caller has to remember it.
 *
 * The import of `AppErrorKind` is type-only on purpose: a value import would
 * pull in `supabase.ts`, whose env validation throws at module load, and this
 * module has to stay importable in a bare Node test process.
 */

export type { Dict, StringKey }
export { bn, en }

export const DICTS: Record<Locale, Dict> = { bn, en }
export const LOCALES: readonly Locale[] = ['bn', 'en']

/** Values allowed in a placeholder. Numbers get digit-localised; strings do not. */
export type TVar = string | number | null | undefined
export type TVars = Record<string, TVar>

export type TFunction = (key: StringKey, vars?: TVars) => string

/**
 * `{name}` substitutes a value. `{name|one|many}` substitutes a *word* chosen by
 * that value's count — used only by English, which inflects where Bengali does
 * not: '{count} {count|product|products} running low'.
 */
const PLACEHOLDER = /\{(\w+)(?:\|([^{}]*))?\}/g

function renderVar(value: TVar, locale: Locale): string {
  if (value == null) return '—'
  if (typeof value === 'number') {
    return formatNumber(value, locale, { decimals: 'auto' })
  }
  return value
}

function pickPlural(value: TVar, alternatives: string): string {
  const forms = alternatives.split('|')
  const n = typeof value === 'number' ? value : Number(value)
  // Zero takes the plural in both languages: "0 products", not "0 product".
  return (Number.isFinite(n) && Math.abs(n) === 1 ? forms[0] : forms[1]) ?? forms[0] ?? ''
}

export function interpolate(template: string, locale: Locale, vars?: TVars): string {
  if (!vars || !template.includes('{')) return template
  return template.replace(PLACEHOLDER, (whole, name: string, alternatives?: string) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    return alternatives == null ? renderVar(value, locale) : pickPlural(value, alternatives)
  })
}

/**
 * The lookup itself. A key missing from the active dictionary falls back to
 * Bengali rather than rendering blank — a shopkeeper seeing the Bengali label on
 * an otherwise-English screen is a cosmetic problem; an empty button is not.
 */
export function translate(locale: Locale, key: StringKey, vars?: TVars): string {
  const template = DICTS[locale]?.[key] ?? bn[key] ?? key
  return interpolate(template, locale, vars)
}

export function makeT(locale: Locale): TFunction {
  return (key, vars) => translate(locale, key, vars)
}

export function isStringKey(value: string): value is StringKey {
  return Object.prototype.hasOwnProperty.call(bn, value)
}

/**
 * Maps a thrown `AppError` onto something a shopkeeper can act on.
 *
 * The kinds and the message keys are not one-to-one, and pretending they were
 * (by interpolating `error.${kind}`) would silently render the raw key for
 * 'offline', 'validation', 'conflict' and 'server'. Hence the explicit table.
 */
const ERROR_KEYS: Record<AppErrorKind, StringKey> = {
  offline: 'error.network',
  auth: 'error.signedOut',
  permission: 'error.permission',
  billing: 'error.billing',
  validation: 'error.generic',
  conflict: 'error.generic',
  notfound: 'error.notFound',
  server: 'error.generic',
}

/**
 * Takes a plain `string`, not `AppErrorKind`.
 *
 * By the time an error reaches a toast it has usually been through a `catch` and
 * is typed `unknown`, so its `kind` is a string we have not verified. Widening the
 * parameter puts the fallback here instead of forcing a cast at every call site.
 * Exhaustiveness is still enforced — on `ERROR_KEYS`, where it belongs.
 */
export function errorKey(kind: string): StringKey {
  return ERROR_KEYS[kind as AppErrorKind] ?? 'error.generic'
}

/**
 * Whether the message on an error is worth showing verbatim.
 *
 * Validation and conflict messages come from our own `RAISE` statements in the
 * RPCs and are already written in Bengali for a shopkeeper. Everything else is
 * PostgREST or network plumbing, and shows the generic label instead.
 */
export function usesServerMessage(kind: string): boolean {
  return kind === 'validation' || kind === 'conflict'
}

/**
 * Turns anything that was thrown into a sentence for the user.
 *
 * There are three kinds of message in this app and exactly one place that has to
 * tell them apart, which is here:
 *
 *  - A dictionary key, when our own code raised the error to say something
 *    specific — `AppError('validation', 'auth.wrongCredentials')`. Writing keys
 *    rather than prose keeps `AuthProvider` and the RPC wrappers free of any
 *    dependency on the locale, so `I18nProvider` does not have to sit above them.
 *  - Bengali prose from a `RAISE` in one of our RPCs, already written for a
 *    shopkeeper: 'এই খরিদ্দারের বাকির সীমা পার হয়ে যাচ্ছে'.
 *  - Plumbing — PostgREST, fetch, the auth API — which the user cannot act on and
 *    should never see. Those get the generic label for their kind.
 */
export function errorMessage(
  locale: Locale,
  error: unknown,
  fallback: StringKey = 'error.generic',
): string {
  const candidate = error as { kind?: unknown; message?: unknown } | null
  const raw = typeof candidate?.message === 'string' ? candidate.message : ''
  if (isStringKey(raw)) return translate(locale, raw)

  const kind = typeof candidate?.kind === 'string' ? candidate.kind : ''
  if (raw && usesServerMessage(kind)) return raw
  return translate(locale, kind ? errorKey(kind) : fallback)
}

/**
 * A stored string that may be either a key or prose.
 *
 * The outbox keeps `lastError` as a bare string, and by the time it is read the
 * `kind` that would have explained it is a separate column and the locale may have
 * changed twice. Both sources are legitimate — our own code writes keys so it can
 * stay locale-free, Postgres writes Bengali prose — so the decision has to be made
 * at the moment of display. Unlike `errorMessage`, prose is passed through rather
 * than replaced by a generic label: a specific message that survived a night in
 * IndexedDB is the most useful thing on that screen.
 */
export function textOrKey(locale: Locale, value: string): string {
  return isStringKey(value) ? translate(locale, value) : value
}
