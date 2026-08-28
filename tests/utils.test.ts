import {
  buzz,
  clamp,
  cn,
  compact,
  debounce,
  deviceLabel,
  foldForSearch,
  groupBy,
  matchesSearch,
  newId,
  safeJsonParse,
  searchRank,
  sleep,
  sum,
  uniqueBy,
} from '@/lib/utils'
import { close, deepEq, eq, match, notOk, ok, suite } from './_harness'

suite('cn')
eq(cn('p-2', 'text-lg'), 'p-2 text-lg', 'joins')
eq(cn('p-2', false, null, undefined), 'p-2', 'drops falsy')
eq(cn('a', ['b', ['c']]), 'a b c', 'flattens nested arrays')
eq(cn(), '', 'nothing in, nothing out')

suite('newId — the idempotency key the whole offline design rests on')
match(
  newId(),
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'shaped like a v4 UUID',
)
eq(new Set(Array.from({ length: 2000 }, newId)).size, 2000, 'no collisions in 2000 draws')

suite('search folding')
eq(foldForSearch('মিনিকেট  চাল ৫০০'), 'মিনিকেট চাল 500', 'collapses spaces, folds digits')
eq(foldForSearch('Sugar 1kg'), 'sugar 1kg', 'lowercases')
eq(foldForSearch('  Rice, 5kg!  '), 'rice 5kg', 'punctuation becomes a separator')
eq(foldForSearch(null), '', 'null')
// ড় exists twice in Unicode: precomposed U+09DC, and U+09A1 + U+09BC. It is a
// composition exclusion, so NFC will not unify them — folding must.
eq(
  foldForSearch('ড়'),
  foldForSearch('ড়'),
  'precomposed and decomposed ড় fold alike',
)
eq(foldForSearch('য়'), foldForSearch('য়'), 'and য়')
eq(foldForSearch('ড়া'), foldForSearch('ড়া'), 'with a vowel sign attached')
eq(
  foldForSearch('গুঁড়া‌দুধ'),
  foldForSearch('গুঁড়াদুধ'),
  'a zero-width non-joiner in the middle of a word is ignored',
)
ok(foldForSearch('গুঁড়া').includes('ঁ'), 'but chandrabindu and vowel signs are kept')
eq(foldForSearch('café'), 'cafe', 'latin accents too')

suite('matchesSearch')
ok(matchesSearch('চাল মিনিকেট', 'Miniket Rice', 'মিনিকেট চাল'), 'word order does not matter')
ok(matchesSearch('500', 'Soybean Oil 500ml', null), 'digits in the name')
ok(matchesSearch('৫০০', 'Soybean Oil 500ml', null), 'Bengali digits find Latin ones')
ok(matchesSearch('rice min', 'Miniket Rice'), 'tokens may match in any order or field')
notOk(matchesSearch('atta', 'Sugar', 'চিনি'), 'no false positive')
ok(matchesSearch('', 'anything'), 'an empty query matches everything')
ok(matchesSearch('   ', 'anything'), 'whitespace-only too')

suite('searchRank — exact, then prefix, then substring')
eq(searchRank('chinigura rice', 'Chinigura Rice'), 0, 'exact')
eq(searchRank('chi', 'Chinigura Rice', 'চিনিগুড়া'), 1, 'prefix')
eq(searchRank('rice', 'Chinigura Rice'), 2, 'substring')
eq(searchRank('চিনি', 'Chinigura Rice', 'চিনিগুড়া'), 3, 'secondary field')
eq(searchRank('xyz', 'Chinigura Rice', 'চিনিগুড়া'), 4, 'no match sorts last')
eq(searchRank('', 'anything'), 0, 'empty query is neutral')

suite('collections')
eq(sum([{ n: 1 }, { n: null }, { n: 2.5 }], (r) => r.n), 3.5, 'nulls count as zero')
eq(sum([], (r: { n: number }) => r.n), 0, 'empty')
deepEq(
  groupBy([{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }], (r) => r.k as 'a' | 'b'),
  { a: [{ k: 'a', v: 1 }, { k: 'a', v: 3 }], b: [{ k: 'b', v: 2 }] },
  'groupBy',
)
deepEq(uniqueBy([{ id: 'x' }, { id: 'x' }, { id: 'y' }], (r) => r.id), [{ id: 'x' }, { id: 'y' }], 'uniqueBy keeps the first')
eq(clamp(12, 0, 5), 5, 'clamps high')
eq(clamp(-2, 0, 5), 0, 'clamps low')
eq(clamp(3, 0, 5), 3, 'passes through')
deepEq(compact({ a: 1, b: undefined, c: null }), { a: 1, c: null }, 'undefined dropped, null kept')
deepEq(safeJsonParse('{"a":1}', {}), { a: 1 }, 'parses')
deepEq(safeJsonParse('{bad', { fallback: true }), { fallback: true }, 'falls back on junk')
deepEq(safeJsonParse(null, { fallback: true }), { fallback: true }, 'falls back on null')

suite('debounce')
let calls = 0
const bump = debounce(() => { calls += 1 }, 20)
bump()
bump()
bump()
eq(calls, 0, 'nothing fires synchronously')
await sleep(50)
eq(calls, 1, 'three rapid calls collapse into one')
const cancelled = debounce(() => { calls += 1 }, 20)
cancelled()
cancelled.cancel()
await sleep(40)
eq(calls, 1, 'cancel means never')

suite('timing')
const start = Date.now()
await sleep(30)
close(Date.now() - start >= 25 ? 1 : 0, 1, 'sleep actually waits')

suite('device')
match(deviceLabel(), /^(Android|iOS|Windows|Mac|Web)$/, 'one of the known labels')
buzz()
ok(true, 'buzz is a no-op where vibrate is unavailable, and does not throw')
