import {
  DICTS,
  LOCALES,
  bn,
  en,
  errorKey,
  interpolate,
  isStringKey,
  makeT,
  translate,
  usesServerMessage,
} from '@/i18n/strings'
import type { StringKey } from '@/i18n/strings'
import { deepEq, eq, notOk, ok, suite } from './_harness'

/** `{name}` and `{name|one|many}` — we only care about the variable name here. */
function varNames(template: string): string[] {
  const names = new Set<string>()
  for (const m of template.matchAll(/\{(\w+)(?:\|[^{}]*)?\}/g)) names.add(m[1])
  return [...names].sort()
}

const bnKeys = Object.keys(bn) as StringKey[]
const enKeys = Object.keys(en) as StringKey[]

suite('dictionary parity — a missing translation is a blank button in production')
eq(enKeys.length, bnKeys.length, `same number of keys (${bnKeys.length})`)
deepEq(enKeys, bnKeys, 'same keys, in the same order — so the two files stay diffable')
ok(bnKeys.length > 200, 'and the dictionary is actually populated')

const missingInEn = bnKeys.filter((k) => !(k in en))
const extraInEn = enKeys.filter((k) => !(k in bn))
deepEq(missingInEn, [], 'nothing missing from English')
deepEq(extraInEn, [], 'and nothing invented in English')

suite('no empty or placeholder-only values')
for (const locale of LOCALES) {
  const dict = DICTS[locale]
  const blank = bnKeys.filter((k) => !dict[k] || !dict[k].trim())
  deepEq(blank, [], `${locale}: every key has a value`)
  const untranslated = bnKeys.filter((k) => dict[k] === k)
  deepEq(untranslated, [], `${locale}: no value left as its own key`)
}

suite('placeholders agree across languages')
const placeholderMismatch = bnKeys.filter((k) => {
  const a = varNames(bn[k]).join(',')
  const b = varNames(en[k]).join(',')
  return a !== b
})
deepEq(
  placeholderMismatch,
  [],
  'the same vars object has to satisfy both dictionaries',
)
// A stray brace is invisible in review and renders literally on screen.
const unbalanced = bnKeys.filter((k) =>
  LOCALES.some((l) => {
    const v = DICTS[l][k]
    const opens = (v.match(/\{/g) ?? []).length
    const closes = (v.match(/\}/g) ?? []).length
    return opens !== closes
  }),
)
deepEq(unbalanced, [], 'braces are balanced')

suite('script hygiene')
// English strings must not silently ship Bengali text. Two keys are meant to.
const BENGALI_ALLOWED_IN_EN = new Set<StringKey>(['settings.languageBn'])
const bengaliInEn = enKeys.filter(
  (k) => !BENGALI_ALLOWED_IN_EN.has(k) && /[ঀ-৿]/.test(en[k]),
)
deepEq(bengaliInEn, [], 'no untranslated Bengali hiding in en.ts')
// And Bengali strings must not carry Latin digits — ৭ দিন, never 7 দিন. The
// exceptions are the English-language label and the app name in Latin script.
const LATIN_DIGITS_ALLOWED_IN_BN = new Set<StringKey>([])
const latinDigitsInBn = bnKeys.filter(
  (k) => !LATIN_DIGITS_ALLOWED_IN_BN.has(k) && /[0-9]/.test(bn[k]),
)
deepEq(latinDigitsInBn, [], 'Bengali numerals throughout')

suite('interpolation')
eq(interpolate('মোট {amount}', 'bn', { amount: '৳৫০০' }), 'মোট ৳৫০০', 'a formatted string passes through')
eq(interpolate('{count}টি পণ্য', 'bn', { count: 5 }), '৫টি পণ্য', 'a number is localised, not stringified')
eq(interpolate('{count}টি পণ্য', 'bn', { count: 1250 }), '১,২৫০টি পণ্য', 'and grouped')
eq(interpolate('{count} items', 'en', { count: 1250 }), '1,250 items', 'grouped in English too')
eq(interpolate('{name} এল', 'bn', { name: null }), '— এল', 'a null var is a dash, not "null"')
eq(interpolate('{a} {b}', 'bn', { a: '১' }), '১ {b}', 'an unsupplied var is left alone rather than blanked')
eq(interpolate('no vars here', 'bn', { a: 1 }), 'no vars here', 'nothing to do')
eq(interpolate('{count} left', 'en'), '{count} left', 'no vars object at all')

suite('English plural forms')
eq(interpolate('{n} {n|product|products}', 'en', { n: 1 }), '1 product', 'one')
eq(interpolate('{n} {n|product|products}', 'en', { n: 2 }), '2 products', 'many')
eq(interpolate('{n} {n|product|products}', 'en', { n: 0 }), '0 products', 'zero takes the plural')
eq(interpolate('{n} {n|product|products}', 'en', { n: -1 }), '-1 product', 'magnitude decides')
eq(en['home.saleCount'], '{count} {count|sale|sales}', 'the dashboard uses it')

suite('translate')
const t = makeT('bn')
eq(t('nav.khata'), 'বাকি', 'bengali')
eq(makeT('en')('nav.khata'), 'Khata', 'english')
eq(t('home.greeting', { name: 'রফিক' }), 'আসসালামু আলাইকুম, রফিক', 'with a var')
eq(
  t('khata.reminderText', { shop: 'রহিম স্টোর', amount: '৳১,২৫০' }),
  'রহিম স্টোর: আপনার বাকি ৳১,২৫০। সময় করে দিয়ে যাবেন। ধন্যবাদ।',
  'the reminder a customer actually receives',
)
eq(translate('en', 'report.profitExplain'), 'Sales − cost of goods − expenses = net profit', 'the one sentence that sells the product')
// The types prevent this, but a stale build or hand-edited JSON could not.
eq(translate('en', 'no.such.key' as StringKey), 'no.such.key', 'an unknown key renders as itself, never blank')

suite('key guard')
ok(isStringKey('nav.home'), 'known key')
notOk(isStringKey('nav.nope'), 'unknown key')
notOk(isStringKey('toString'), 'and not something off Object.prototype')

suite('error kinds all resolve to a real message')
const KINDS = [
  'offline',
  'auth',
  'permission',
  'billing',
  'validation',
  'conflict',
  'notfound',
  'server',
] as const
for (const kind of KINDS) {
  ok(isStringKey(errorKey(kind)), `${kind} → ${errorKey(kind)}`)
}
eq(errorKey('offline'), 'error.network', 'offline speaks of the internet, not of an error')
ok(usesServerMessage('validation'), 'our own RAISE messages are already shopkeeper-readable')
notOk(usesServerMessage('server'), 'PostgREST internals are not')
