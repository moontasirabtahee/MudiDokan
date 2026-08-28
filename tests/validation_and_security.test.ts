import {
  clamp,
  cleanPhoneForDialing,
  compact,
  deviceLabel,
  foldForSearch,
  isBangladeshiPhone,
  matchesSearch,
  newId,
  safeJsonParse,
  searchRank,
  sum,
  uniqueBy,
} from '@/lib/utils'
import { LIMITS, ROLES, hasMinRole } from '@/lib/constants'
import { deepEq, eq, match, notOk, ok, suite } from './_harness'

/* ── Bangladeshi Phone Validation ────────────────────────────────────────── */

suite('isBangladeshiPhone validation')

// Valid 11-digit local format across all BD operators
ok(isBangladeshiPhone('01712345678'), 'Grameenphone (017)')
ok(isBangladeshiPhone('01312345678'), 'Grameenphone (013)')
ok(isBangladeshiPhone('01812345678'), 'Robi (018)')
ok(isBangladeshiPhone('01612345678'), 'Airtel (016)')
ok(isBangladeshiPhone('01912345678'), 'Banglalink (019)')
ok(isBangladeshiPhone('01412345678'), 'Banglalink (014)')
ok(isBangladeshiPhone('01512345678'), 'Teletalk (015)')

// Valid +880 and 880 formats
ok(isBangladeshiPhone('+8801712345678'), 'with +880 prefix')
ok(isBangladeshiPhone('8801812345678'), 'with 880 prefix')

// Formatted with dashes, spaces, and parentheses
ok(isBangladeshiPhone('01712-345678'), 'with hyphen')
ok(isBangladeshiPhone('01712 345 678'), 'with spaces')
ok(isBangladeshiPhone('+88 (017) 1234-5678'), 'with brackets and hyphens')

// Valid Bengali digits
ok(isBangladeshiPhone('০১৭১২৩৪৫৬৭৮'), 'Bengali digits local format')
ok(isBangladeshiPhone('+৮৮০১৮১২৩৪৫৬৭৮'), 'Bengali digits with +880')

// Invalid numbers
notOk(isBangladeshiPhone(''), 'empty string is invalid')
notOk(isBangladeshiPhone(null), 'null is invalid')
notOk(isBangladeshiPhone(undefined), 'undefined is invalid')
notOk(isBangladeshiPhone('01212345678'), 'invalid operator prefix 012')
notOk(isBangladeshiPhone('01112345678'), 'invalid operator prefix 011 (Citycell retired)')
notOk(isBangladeshiPhone('01012345678'), 'invalid operator prefix 010')
notOk(isBangladeshiPhone('0171234567'), 'too short (10 digits)')
notOk(isBangladeshiPhone('017123456789'), 'too long (12 digits)')
notOk(isBangladeshiPhone('1712345678'), 'missing leading 0 (10 digits)')
notOk(isBangladeshiPhone('abcdefghijk'), 'non-numeric string')

/* ── cleanPhoneForDialing ─────────────────────────────────────────────────── */

suite('cleanPhoneForDialing helper')

eq(cleanPhoneForDialing('01712-345 678'), '01712345678', 'strips dashes and spaces')
eq(cleanPhoneForDialing('+8801812345678'), '8801812345678', 'extracts digits from international format')
eq(cleanPhoneForDialing('০১৭১২-৩৪৫৬৭৮'), '01712345678', 'converts Bengali digits to standard Latin digits')
eq(cleanPhoneForDialing(''), '', 'empty returns empty')
eq(cleanPhoneForDialing(null), '', 'null returns empty')

/* ── Search & Folding ─────────────────────────────────────────────────────── */

suite('foldForSearch & matchesSearch with Bengali text')

// Nukta normalization (ড় -> ড, ঢ় -> ঢ, য় -> য)
eq(foldForSearch('আড়াই কেজি'), foldForSearch('আড়াই কেজি'), 'nukta decomposition matches alternative spellings')
eq(foldForSearch('মিনিকেট চাল'), foldForSearch('মিনিকেট  চাল'), 'collapses multiple spaces')

// Zero-width joiner & invisible characters stripping
const withZwnj = 'তেল​' // contains zero width space
eq(foldForSearch(withZwnj), 'তেল', 'strips invisible characters')

// Matches search (order-independent)
ok(matchesSearch('চাল মিনিকেট', 'মিনিকেট চাল ৫০ কেজি'), 'matches when search tokens are reversed')
ok(matchesSearch('লবণ ৫০০', 'লবণ ৫০০ গ্রাম প্যাকেট'), 'matches Bengali and numeric tokens')
ok(matchesSearch('500 লবণ', 'লবণ ৫০০ গ্রাম প্যাকেট'), 'matches Latin digits against Bengali digits')
ok(matchesSearch('', 'যেকোনো পণ্য'), 'empty query matches all')
notOk(matchesSearch('চিনি লাল', 'সাদা চিনি ৫০ কেজি'), 'rejects when one token is missing')

// Search rank
eq(searchRank('চিনি', 'চিনি'), 0, 'exact match rank 0')
eq(searchRank('চিনি', 'চিনিগুঁড়া চাল'), 1, 'prefix match rank 1')
eq(searchRank('চিনি', 'দেশি চিনি'), 2, 'substring match rank 2')
eq(searchRank('চিনি', 'লবণ', 'সাদা চিনি'), 3, 'secondary field match rank 3')
eq(searchRank('চিনি', 'লবণ', 'ডাল'), 4, 'unmatched rank 4')

/* ── Data Utilities & Invariants ─────────────────────────────────────────── */

suite('clamp & compact & safeJsonParse & sum')

// clamp
eq(clamp(5, 0, 10), 5, 'within bounds')
eq(clamp(-5, 0, 10), 0, 'lower bound clamp')
eq(clamp(15, 0, 10), 10, 'upper bound clamp')

// compact
const withUndefined = { a: 1, b: undefined, c: 'text', d: null }
const compacted = compact(withUndefined)
eq(compacted.a, 1, 'keeps defined number')
eq(compacted.c, 'text', 'keeps defined string')
eq(compacted.d, null, 'keeps explicit null')
ok(!('b' in compacted), 'removes undefined key')

// safeJsonParse
deepEq(safeJsonParse('{"valid": 123}', {}), { valid: 123 }, 'parses valid JSON')
deepEq(safeJsonParse('invalid json string', { fallback: true }), { fallback: true }, 'falls back on malformed JSON')
eq(safeJsonParse(null, 'default'), 'default', 'handles null safely')
eq(safeJsonParse('', 'default'), 'default', 'handles empty string')

// sum
const items = [{ price: 10 }, { price: 20 }, { price: null }, { price: 30 }]
eq(sum(items, (i) => i.price), 60, 'sums ignoring nulls')

// uniqueBy
const duplicates = [
  { id: '1', name: 'Item 1' },
  { id: '2', name: 'Item 2' },
  { id: '1', name: 'Item 1 duplicate' },
]
eq(uniqueBy(duplicates, (i) => i.id).length, 2, 'deduplicates by id')

/* ── Security & Limits Invariants ────────────────────────────────────────── */

suite('LIMITS & Constants Invariants')

ok(LIMITS.catalogMax >= 100, 'catalog max limit is safe')
ok(LIMITS.maxSaleLines >= 20, 'maxSaleLines is reasonable for POS')
ok(ROLES.owner !== undefined, 'owner role exists')
ok(ROLES.manager !== undefined, 'manager role exists')
ok(ROLES.cashier !== undefined, 'cashier role exists')

// Role permissions hierarchy: owner > manager > cashier
ok(hasMinRole('owner', 'owner'), 'owner has owner permissions')
ok(hasMinRole('owner', 'manager'), 'owner has manager permissions')
ok(hasMinRole('owner', 'cashier'), 'owner has cashier permissions')
notOk(hasMinRole('manager', 'owner'), 'manager cannot access owner actions')
ok(hasMinRole('manager', 'manager'), 'manager has manager permissions')
ok(hasMinRole('manager', 'cashier'), 'manager has cashier permissions')
notOk(hasMinRole('cashier', 'owner'), 'cashier cannot access owner actions')
notOk(hasMinRole('cashier', 'manager'), 'cashier cannot access manager actions')
ok(hasMinRole('cashier', 'cashier'), 'cashier has cashier permissions')
notOk(hasMinRole(null, 'cashier'), 'unauthenticated has no permissions')

// newId UUID format check
const uuid = newId()
match(
  uuid,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'newId produces valid UUID v4 format',
)
