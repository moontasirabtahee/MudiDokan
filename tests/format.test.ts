import {
  DEFAULT_TZ,
  addDays,
  daysBetween,
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
  initials,
  isoDay,
  parseAmount,
  roundTo,
  telHref,
  toBengaliDigits,
  toLatinDigits,
  todayIso,
  unitLabel,
  weekdayLabel,
} from '@/lib/format'
import { eq, match, ok, suite } from './_harness'

const tz = DEFAULT_TZ

suite('digits')
eq(toBengaliDigits('12450'), '১২৪৫০', 'latin → bengali')
eq(toLatinDigits('১২৪৫০'), '12450', 'bengali → latin')
eq(toLatinDigits('٥٠٠'), '500', 'arabic-indic keyboards fold too')
eq(toBengaliDigits('RS-1024'), 'RS-১০২৪', 'non-digits pass through')

suite('grouping — South Asian, not Western')
eq(formatNumber(999, 'en'), '999', 'under a thousand')
eq(formatNumber(12345, 'en'), '12,345', 'thousands')
eq(formatNumber(123456, 'en'), '1,23,456', 'one lakh')
eq(formatNumber(1234567, 'en'), '12,34,567', 'twelve lakh — not 1,234,567')
eq(formatNumber(123456789, 'en'), '12,34,56,789', 'crores')
eq(formatNumber(1234567, 'bn'), '১২,৩৪,৫৬৭', 'and in Bengali digits')
eq(formatNumber(1234, 'en', { group: false }), '1234', 'grouping can be turned off')
eq(formatNumber(null, 'bn'), '০', 'null is zero, not NaN')
eq(formatNumber(Number.NaN, 'en'), '0', 'NaN is zero')

suite('money')
eq(formatMoney(120, 'bn'), '৳১২০', 'whole taka show no paisa')
eq(formatMoney(120.5, 'bn'), '৳১২০.৫', 'a single paisa digit is not padded')
eq(formatMoney(120.456, 'en'), '৳120.46', 'rounds to paisa')
eq(formatMoney(-320, 'bn'), '-৳৩২০', 'sign sits outside the symbol')
eq(formatMoney(0, 'bn'), '৳০', 'zero')
eq(formatMoney(1500, 'en', { signed: true }), '+৳1,500', 'signed positive')
eq(formatMoney(250, 'bn', { symbol: false }), '২৫০', 'symbol optional')
eq(formatMoneyCompact(950, 'en'), '৳950', 'under a thousand stays exact')
eq(formatMoneyCompact(12500, 'bn'), '৳১২.৫ হাজার', 'thousands')
eq(formatMoneyCompact(340000, 'en'), '৳3.4 L', 'lakh')
eq(formatMoneyCompact(25000000, 'bn'), '৳২.৫ কোটি', 'crore')

suite('rounding — a paisa must not vanish')
eq(roundTo(1.005, 2), 1.01, '1.005 rounds up despite the float')
eq(roundTo(2.675, 2), 2.68, '2.675 rounds up')
eq(roundTo(-1.005, 2), -1.01, 'and symmetrically for negatives')
eq(roundTo(10, 2), 10, 'integers are untouched')

suite('quantities')
eq(formatQty(1.5, 'kg', 'bn'), '১.৫ কেজি', 'weighed')
eq(formatQty(3, 'piece', 'bn'), '৩ পিস', 'counted')
eq(formatQty(2.0, 'litre', 'en'), '2 L', 'trailing zeros dropped')
eq(formatQty(0.25, 'kg', 'en'), '0.25 kg', 'quarter kilo')
eq(formatQty(4, null, 'bn'), '৪', 'unit optional')
eq(unitLabel('hali', 'bn'), 'হালি', 'hali has no English equivalent')
eq(unitLabel('hali', 'en', false), 'hali (4)', 'so English spells out the count')
eq(unitLabel('gram', 'en'), 'g', 'short by default')
eq(unitLabel('nonsense', 'bn'), 'nonsense', 'unknown units pass through')

suite('parsing what a human types')
eq(parseAmount('১,২৫০'), 1250, 'bengali digits with a grouping comma')
eq(parseAmount('৳ 320'), 320, 'symbol and space')
eq(parseAmount('1 000'), 1000, 'thin-space grouping')
eq(parseAmount('12.'), 12, 'mid-typing trailing dot')
eq(parseAmount('.5'), 0.5, 'leading dot')
eq(parseAmount('-40'), -40, 'negative')
eq(parseAmount(''), null, 'empty is null, not zero — do not stamp a 0 over typing')
eq(parseAmount('.'), null, 'a lone dot is not a number yet')
eq(parseAmount('abc'), null, 'junk')
eq(parseAmount('12abc'), null, 'partial junk is rejected outright')
eq(parseAmount(450), 450, 'numbers pass through')
eq(parseAmount(null), null, 'null')

suite('percentages')
eq(formatPercent(23.456, 'bn'), '২৩.৫%', 'one decimal')
eq(formatPercent(null, 'bn'), '—', 'null margin is a dash, not 0%')
eq(formatPercent(0, 'en'), '0.0%', 'zero is a real value')

suite('timezone day boundaries')
eq(isoDay('2026-08-26T18:30:00Z', tz), '2026-08-27', '18:30 UTC is already tomorrow in Dhaka')
eq(isoDay('2026-08-26T17:59:00Z', tz), '2026-08-26', 'a minute earlier is still today')
eq(isoDay('2026-08-26', tz), '2026-08-26', 'a bare date keeps its calendar day')
eq(isoDay('2026-01-01T00:30:00Z', tz), '2026-01-01', 'new year, +6 offset')
eq(addDays('2026-08-31', 1), '2026-09-01', 'month rollover')
eq(addDays('2026-03-01', -1), '2026-02-28', 'backwards over February')
eq(addDays('2028-03-01', -1), '2028-02-29', 'leap year')
eq(daysBetween('2026-08-20', '2026-08-26'), 6, 'six days')
eq(daysBetween('2026-08-26', '2026-08-20'), -6, 'and negative the other way')
match(todayIso(tz), /^\d{4}-\d{2}-\d{2}$/, 'todayIso shape')

suite('dates')
eq(formatDate('2026-08-26', 'bn', tz), '২৬ আগস্ট', 'bengali day-then-month')
eq(formatDate('2026-08-26', 'en', tz), 'August 26', 'english month-then-day')
eq(formatDate('2026-08-26', 'en', tz, { withYear: true }), 'August 26, 2026', 'with year')
eq(formatDate('2026-10-05', 'bn', tz, { short: true }), '৫ অক্টো', 'abbreviations are spelled out')
eq(formatDate('2026-02-05', 'bn', tz, { short: true }), '৫ ফেব', 'not sliced mid-cluster')
eq(formatDate(null, 'bn', tz), '—', 'null is a dash')
eq(weekdayLabel('2026-08-26', 'bn', tz), 'বুধ', 'weekday short bn')
eq(weekdayLabel('2026-08-26', 'en', tz, false), 'Wednesday', 'weekday long en')

suite('time — Bengali names the part of the day, it does not say AM/PM')
eq(formatTime('2026-08-25T23:00:00Z', 'bn', tz), 'ভোর ৫:০০', 'ভোর before six')
eq(formatTime('2026-08-26T00:30:00Z', 'bn', tz), 'সকাল ৬:৩০', 'সকাল from six')
eq(formatTime('2026-08-26T03:30:00Z', 'bn', tz), 'সকাল ৯:৩০', 'সকাল in the morning')
eq(formatTime('2026-08-26T07:30:00Z', 'bn', tz), 'দুপুর ১:৩০', 'দুপুর at midday')
eq(formatTime('2026-08-26T10:15:00Z', 'bn', tz), 'বিকাল ৪:১৫', 'বিকাল in the afternoon')
eq(formatTime('2026-08-26T12:30:00Z', 'bn', tz), 'সন্ধ্যা ৬:৩০', 'সন্ধ্যা at dusk')
eq(formatTime('2026-08-26T16:00:00Z', 'bn', tz), 'রাত ১০:০০', 'রাত at night')
eq(formatTime('2026-08-26T10:15:00Z', 'en', tz), '4:15 PM', 'english keeps AM/PM')
eq(formatTime('2026-08-26T06:00:00Z', 'en', tz), '12:00 PM', 'noon is 12 PM, not 0')
eq(formatTime('2026-08-25T18:00:00Z', 'en', tz), '12:00 AM', 'midnight is 12 AM')

suite('relative day labels')
eq(formatDayLabel(todayIso(tz), 'bn', tz), 'আজ', 'today')
eq(formatDayLabel(addDays(todayIso(tz), -1), 'bn', tz), 'গতকাল', 'yesterday')
eq(formatDayLabel(addDays(todayIso(tz), 1), 'bn', tz), 'আগামীকাল', 'tomorrow')
eq(formatDayLabel(addDays(todayIso(tz), -3), 'bn', tz), '৩ দিন আগে', 'three days ago')
eq(formatDayLabel(addDays(todayIso(tz), -3), 'en', tz), '3 days ago', 'and in English')
ok(
  !formatDayLabel(addDays(todayIso(tz), -40), 'bn', tz).includes('দিন আগে'),
  'beyond a week it switches to a date — "৪০ দিন আগে" makes you do arithmetic',
)
eq(formatAge(0, 'bn'), 'আজকের', 'a due opened today')
eq(formatAge(12, 'bn'), '১২ দিন', 'days')
eq(formatAge(45, 'bn'), '১ মাস', 'months past thirty days')
eq(formatAge(null, 'bn'), '—', 'no age')
match(formatDateTime('2026-08-26T10:15:00Z', 'bn', tz), /২৬ আগস্ট, বিকাল ৪:১৫/, 'date + time')

suite('text')
eq(initials('রফিক উদ্দিন'), 'রউ', 'two Bengali words')
eq(initials('Sumon'), 'S', 'one word')
eq(initials('   '), '?', 'blank')
eq(formatPhone('01712345678', 'bn'), '০১৭১২-৩৪৫৬৭৮', 'grouped and localised')
eq(formatPhone('123', 'bn'), '১২৩', 'unexpected length is still localised, just not grouped')
eq(formatPhone(null, 'bn'), '—', 'no phone')
eq(telHref('01712345678'), 'tel:+8801712345678', 'local number gets +880')
eq(telHref('8801712345678'), 'tel:+8801712345678', 'already-prefixed number')
eq(telHref(null), null, 'no number, no link')
eq(displayName({ name: 'Sugar', name_bn: 'চিনি' }, 'bn'), 'চিনি', 'bengali name preferred')
eq(displayName({ name: 'Sugar', name_bn: null }, 'bn'), 'Sugar', 'falls back to english')
eq(displayName({ name: 'Sugar', name_bn: '  ' }, 'bn'), 'Sugar', 'whitespace is not a name')
eq(displayName({ name: 'Sugar', name_bn: 'চিনি' }, 'en'), 'Sugar', 'english locale ignores name_bn')
eq(displayName(null, 'bn'), '—', 'null row')
