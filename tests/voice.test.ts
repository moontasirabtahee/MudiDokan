import {
  detectUnit,
  normalizeBnDigits,
  parseMultiSellItems,
  parseSpokenExpense,
  parseSpokenProduct,
  parseVoiceQty,
} from '@/lib/voice'
import { deepEq, eq, ok, suite } from './_harness'

suite('voice digit normalization')
eq(normalizeBnDigits('১২৩৪৫৬৭৮৯০'), '1234567890', 'Bengali digits normalized')
eq(normalizeBnDigits('চিনি ১২০ টাকা'), 'চিনি 120 টাকা', 'digits inside text normalized')

suite('detectUnit')
eq(detectUnit('২ কেজি চিনি'), 'kg', 'detects kg')
eq(detectUnit('১ লিটার তেল'), 'litre', 'detects litre')
eq(detectUnit('৩ প্যাকেট নুডলস'), 'packet', 'detects packet')
eq(detectUnit('১ ডজন ডিম'), 'dozen', 'detects dozen')
eq(detectUnit('৪ হালি ডিম'), 'hali', 'detects hali')
eq(detectUnit('১ বস্তা চাল'), 'sack', 'detects sack')
eq(detectUnit('৫ পিস সাবান'), 'piece', 'detects piece')

suite('parseVoiceQty')
eq(parseVoiceQty('২ কেজি চিনি').qty, 2, '2 kg')
eq(parseVoiceQty('আধা কেজি ডাল').qty, 0.5, 'half kg')
eq(parseVoiceQty('দেড় লিটার তেল').qty, 1.5, '1.5 litre')
eq(parseVoiceQty('আড়াই কেজি চাল').qty, 2.5, '2.5 kg')

suite('parseMultiSellItems')
const multi = parseMultiSellItems('২ কেজি চিনি, ১ লিটার তেল এবং ৩ প্যাকেট নুডলস')
eq(multi.length, 3, 'extracted 3 items')
eq(multi[0].quantity, 2, 'first item qty 2')
eq(multi[0].unit, 'kg', 'first item unit kg')
eq(multi[1].quantity, 1, 'second item qty 1')
eq(multi[1].unit, 'litre', 'second item unit litre')
eq(multi[2].quantity, 3, 'third item qty 3')
eq(multi[2].unit, 'packet', 'third item unit packet')

suite('parseSpokenProduct')
const prod = parseSpokenProduct('চিনি কেনা ১২০ বেচা ১৩০ স্টক ৫০ কেজি')
ok(prod.name.includes('চিনি'), 'product name')
eq(prod.buyPrice, 120, 'buy price')
eq(prod.sellPrice, 130, 'sell price')
eq(prod.stock, 50, 'stock')
eq(prod.unit, 'kg', 'unit')

suite('parseSpokenExpense')
const exp1 = parseSpokenExpense('দোকান ভাড়া ৫০০০ টাকা')
eq(exp1.category, 'rent', 'rent category')
eq(exp1.amount, 5000, 'rent amount')

const exp2 = parseSpokenExpense('বিদ্যুৎ বিল ১৫০০ টাকা')
eq(exp2.category, 'utility', 'utility category')
eq(exp2.amount, 1500, 'utility amount')

const exp3 = parseSpokenExpense('চা নাস্তা ৬০ টাকা')
eq(exp3.category, 'refreshment', 'refreshment category')
eq(exp3.amount, 60, 'refreshment amount')
