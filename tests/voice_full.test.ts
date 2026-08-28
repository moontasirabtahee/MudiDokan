import {
  detectUnit,
  normalizeBnDigits,
  parseMultiSellItems,
  parseSpokenExpense,
  parseSpokenProduct,
  parseVoiceQty,
} from '@/lib/voice'
import { deepEq, eq, ok, suite } from './_harness'

/* ── Digit Normalization ─────────────────────────────────────────────────── */

suite('voice digit normalization comprehensive')

eq(normalizeBnDigits(''), '', 'empty string')
eq(normalizeBnDigits('১২৩৪৫৬৭৮৯০'), '1234567890', 'all Bengali digits 0-9')
eq(normalizeBnDigits('চিনি ১২০ টাকা ৫০ পয়সা'), 'চিনি 120 টাকা 50 পয়সা', 'mixed text and Bengali digits')
eq(normalizeBnDigits('Rice 50 kg and 200 gm'), 'Rice 50 kg and 200 gm', 'preserves English digits unchanged')
eq(normalizeBnDigits('দাম ১,৫০০.৫০ টাকা'), 'দাম 1,500.50 টাকা', 'preserves punctuation and commas with Bengali numbers')

/* ── Bengali Units Detection ─────────────────────────────────────────────── */

suite('detectUnit comprehensive')

eq(detectUnit('২ কেজি মিনিকেট চাল'), 'kg', 'কেজি -> kg')
eq(detectUnit('৫০০ গ্রাম হলুদ গুঁড়া'), 'kg', 'গ্রাম -> kg')
eq(detectUnit('১ কেজি ২৫০ গ্রাম'), 'kg', 'কেজি/গ্রাম -> kg')
eq(detectUnit('২ কেজির প্যাকেট'), 'kg', 'কেজির -> kg')
eq(detectUnit('১ লিটার সয়াবিন তেল'), 'litre', 'লিটার -> litre')
eq(detectUnit('৫০০ মিলি দুধ'), 'litre', 'মিলি -> litre')
eq(detectUnit('২ লিটারের বোতল'), 'litre', 'লিটারের -> litre')
eq(detectUnit('৩ প্যাকেট ম্যাগি নুডলস'), 'packet', 'প্যাকেট -> packet')
eq(detectUnit('২ প্যাক চিপস'), 'packet', 'প্যাক -> packet')
eq(detectUnit('১ ডজন দেশি ডিম'), 'dozen', 'ডজন -> dozen')
eq(detectUnit('৪ হালি ফার্মের ডিম'), 'hali', 'হালি -> hali')
eq(detectUnit('১ বস্তা নাজিরশাইল চাল'), 'sack', 'বস্তা -> sack')
eq(detectUnit('১ ব্যাগ আটা'), 'sack', 'ব্যাগ -> sack')
eq(detectUnit('৫ পিস লাক্স সাবান'), 'piece', 'পিস -> piece')
eq(detectUnit('২ টি টুথব্রাশ'), 'piece', 'টি -> piece')
eq(detectUnit('৩ টা কলম'), 'piece', 'টা -> piece')
eq(detectUnit('অজানা পণ্য'), null, 'unmatched text returns null')

/* ── Bengali Quantity & Fraction Parsing ─────────────────────────────────── */

suite('parseVoiceQty fractions & colloquial phrases')

const q1 = parseVoiceQty('আধা কেজি মসুর ডাল')
eq(q1.qty, 0.5, 'আধা -> 0.5')
ok(!q1.cleanName.includes('আধা'), 'cleans fraction word')

const q2 = parseVoiceQty('দেড় লিটার সয়াবিন তেল')
eq(q2.qty, 1.5, 'দেড় -> 1.5')

const q3 = parseVoiceQty('দেড় কেজি চিনি')
eq(q3.qty, 1.5, 'দেড় (nukta variation) -> 1.5')

const q4 = parseVoiceQty('আড়াই কেজি বাসমতী চাল')
eq(q4.qty, 2.5, 'আড়াই -> 2.5')

const q5 = parseVoiceQty('আড়াই কেজি পোলাওয়ের চাল')
eq(q5.qty, 2.5, 'আড়াই (nukta variation) -> 2.5')

const q6 = parseVoiceQty('১.৫ কেজি লবণ')
eq(q6.qty, 1.5, 'Bengali decimal 1.5')

const q7 = parseVoiceQty('২.৭৫ লিটার সরিষার তেল')
eq(q7.qty, 2.75, 'Bengali decimal 2.75')

const q8 = parseVoiceQty('২ কেজি চিনি দিন')
eq(q8.qty, 2, 'strips polite Bengali request suffix দিন')
ok(!q8.cleanName.includes('দিন'), 'দিন removed from clean name')

const q9 = parseVoiceQty('৫ টা সাবান লাগবে')
eq(q9.qty, 5, 'strips লাগবে')
ok(!q9.cleanName.includes('লাগবে'), 'লাগবে removed')

/* ── Multi-Item Spoken Sales Phrases ─────────────────────────────────────── */

suite('parseMultiSellItems multiple conjunctions')

const multi1 = parseMultiSellItems('২ কেজি চিনি, ১ লিটার তেল এবং ৪ হালি ডিম')
eq(multi1.length, 3, 'extracted 3 items with comma and এবং')
eq(multi1[0].quantity, 2, 'first qty')
eq(multi1[0].unit, 'kg', 'first unit')
eq(multi1[1].quantity, 1, 'second qty')
eq(multi1[1].unit, 'litre', 'second unit')
eq(multi1[2].quantity, 4, 'third qty')
eq(multi1[2].unit, 'hali', 'third unit')

const multi2 = parseMultiSellItems('১ বস্তা চাল আর ২ প্যাকেট লবণ ও ৩ পিস সাবান')
eq(multi2.length, 3, 'extracted 3 items with আর and ও')
eq(multi2[0].unit, 'sack', 'sack unit')
eq(multi2[1].unit, 'packet', 'packet unit')
eq(multi2[2].unit, 'piece', 'piece unit')

const multi3 = parseMultiSellItems('আধা কেজি ডাল + দেড় লিটার তেল + ১ ডজন ডিম')
eq(multi3.length, 3, 'extracted 3 items with plus separator')
eq(multi3[0].quantity, 0.5, 'half kg')
eq(multi3[1].quantity, 1.5, '1.5 litre')
eq(multi3[2].quantity, 1, '1 dozen')

/* ── Spoken Product Definition Parsing ───────────────────────────────────── */

suite('parseSpokenProduct intelligent extraction')

const p1 = parseSpokenProduct('চিনি কেনার দাম ১২০ বিক্রি দাম ১৩০ স্টক ৫০ কেজি')
ok(p1.name.includes('চিনি'), 'extracts product name')
eq(p1.buyPrice, 120, 'buy price 120')
eq(p1.sellPrice, 130, 'sell price 130')
eq(p1.stock, 50, 'stock 50')
eq(p1.unit, 'kg', 'unit kg')

const p2 = parseSpokenProduct('সয়াবিন তেল ক্রয় ১৮০ বিক্রয় ১৯০ স্টক ১০০ লিটার')
ok(p2.name.includes('সয়াবিন তেল'), 'extracts oil product name')
eq(p2.buyPrice, 180, 'buy price from ক্রয়')
eq(p2.sellPrice, 190, 'sell price from বিক্রয়')
eq(p2.stock, 100, 'stock 100')
eq(p2.unit, 'litre', 'unit litre')

const p3 = parseSpokenProduct('ম্যাগি নুডলস কেনা ২০ বেচা ২৫ স্টক ২০০ প্যাকেট')
eq(p3.buyPrice, 20, 'buy price 20')
eq(p3.sellPrice, 25, 'sell price 25')
eq(p3.stock, 200, 'stock 200')
eq(p3.unit, 'packet', 'unit packet')

const p4 = parseSpokenProduct('লাক্স সাবান কেনা ৪৫ টাকা বেচার দাম ৫০ টাকা স্টক ৫০ পিস')
eq(p4.buyPrice, 45, 'handles টাকা suffix on buy')
eq(p4.sellPrice, 50, 'handles টাকা suffix on sell')
eq(p4.stock, 50, 'stock 50')
eq(p4.unit, 'piece', 'unit piece')

/* ── Spoken Expense Parsing ──────────────────────────────────────────────── */

suite('parseSpokenExpense categories & amounts')

const e1 = parseSpokenExpense('দোকানের ঘর ভাড়া ৮০০০ টাকা দিয়েছি')
eq(e1.category, 'rent', 'rent category for ঘর ভাড়া')
eq(e1.amount, 8000, 'expense amount 8000')

const e2 = parseSpokenExpense('চলতি মাসের কারেন্ট বিল ২২০০ টাকা')
eq(e2.category, 'utility', 'utility category for কারেন্ট বিল')
eq(e2.amount, 2200, 'bill amount 2200')

const e3 = parseSpokenExpense('কর্মচারী মামুনের বেতন ১০০০০ টাকা')
eq(e3.category, 'salary', 'salary category for কর্মচারী বেতন')
eq(e3.amount, 10000, 'salary amount 10000')

const e4 = parseSpokenExpense('মালামাল আনার ভ্যান ভাড়া ৩৫০ টাকা')
eq(e4.category, 'transport', 'transport category for ভ্যান ভাড়া')
eq(e4.amount, 350, 'transport amount 350')

const e5 = parseSpokenExpense('কাস্টমারের চা নাস্তা ৮০ টাকা')
eq(e5.category, 'refreshment', 'refreshment category for চা নাস্তা')
eq(e5.amount, 80, 'refreshment amount 80')

const e6 = parseSpokenExpense('দোকানের ফ্যান মেরামত ৫০০ টাকা')
eq(e6.category, 'repair', 'repair category for মেরামত')
eq(e6.amount, 500, 'repair amount 500')

const e7 = parseSpokenExpense('পৌরসভা ট্রেড লাইসেন্স ফি ১৫০০ টাকা')
eq(e7.category, 'license', 'license category for ট্রেড লাইসেন্স')
eq(e7.amount, 1500, 'license amount 1500')

const e8 = parseSpokenExpense('বিবিধ খরচ ২০০ টাকা')
eq(e8.category, 'other', 'other category for বিবিধ')
eq(e8.amount, 200, 'other amount 200')
