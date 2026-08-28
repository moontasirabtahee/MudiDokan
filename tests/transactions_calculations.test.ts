import { close, deepEq, eq, notOk, ok, suite } from './_harness'
import { formatMoney, formatMoneyCompact, formatNumber, formatPercent, addDays } from '@/lib/format'
import { sum, clamp } from '@/lib/utils'

/* ── Cart Calculations & Fractional Quantities ───────────────────────────── */

suite('Cart Line Total Calculations with Fractional Quantities')

interface CartLine {
  productId: string
  name: string
  unitPrice: number
  qty: number
  unit: string
}

function calculateCart(
  lines: CartLine[],
  discountTaka: number = 0,
  paidTaka: number = 0,
) {
  const lineTotals = lines.map((line) => {
    // Standard grocery line calculation: round to nearest Taka
    const subtotal = Math.round(line.unitPrice * line.qty * 100) / 100
    return { ...line, subtotal }
  })

  const grossTotal = sum(lineTotals, (l) => l.subtotal)
  const clampedDiscount = clamp(discountTaka, 0, grossTotal)
  const netTotal = Math.max(0, Math.round(grossTotal - clampedDiscount))
  const changeTaka = Math.max(0, paidTaka - netTotal)
  const dueTaka = Math.max(0, netTotal - paidTaka)

  return {
    lineTotals,
    grossTotal,
    discountTaka: clampedDiscount,
    netTotal,
    paidTaka,
    changeTaka,
    dueTaka,
  }
}

// 1. Fractional quantity: 0.25 kg dal at 140/kg = 35 tk, 1.5 litre oil at 180/litre = 270 tk
const cart1 = calculateCart([
  { productId: 'p1', name: 'মসুর ডাল', unitPrice: 140, qty: 0.25, unit: 'kg' },
  { productId: 'p2', name: 'সয়াবিন তেল', unitPrice: 180, qty: 1.5, unit: 'litre' },
  { productId: 'p3', name: 'ডিম', unitPrice: 12, qty: 4, unit: 'piece' },
])

eq(cart1.lineTotals[0].subtotal, 35, '0.25 kg * 140 = 35 tk')
eq(cart1.lineTotals[1].subtotal, 270, '1.5 litre * 180 = 270 tk')
eq(cart1.lineTotals[2].subtotal, 48, '4 pieces * 12 = 48 tk')
eq(cart1.grossTotal, 353, 'gross total 353 tk')
eq(cart1.netTotal, 353, 'net total without discount 353 tk')

// 2. Discount clamping and change calculations
const cart2 = calculateCart(
  [
    { productId: 'p1', name: 'চিনি', unitPrice: 130, qty: 2, unit: 'kg' }, // 260
    { productId: 'p2', name: 'আটা', unitPrice: 55, qty: 2, unit: 'kg' },   // 110
  ],
  20,  // 20 tk discount
  500, // Customer paid 500 tk note
)

eq(cart2.grossTotal, 370, 'gross total = 260 + 110 = 370')
eq(cart2.discountTaka, 20, 'discount 20')
eq(cart2.netTotal, 350, 'net total = 370 - 20 = 350')
eq(cart2.changeTaka, 150, 'change given back = 500 - 350 = 150')
eq(cart2.dueTaka, 0, 'no due remaining')

// 3. Khata credit sale (partial payment with remaining due)
const cart3 = calculateCart(
  [
    { productId: 'p1', name: 'মিনিকেট চাল ৫০ কেজি বস্তা', unitPrice: 3400, qty: 1, unit: 'sack' },
    { productId: 'p2', name: 'সয়াবিন তেল ৫ লিটার', unitPrice: 850, qty: 1, unit: 'litre' },
  ],
  50,   // 50 tk discount
  2000, // Customer paid 2000 in cash, rest on credit
)

eq(cart3.grossTotal, 4250, 'gross total 4250')
eq(cart3.netTotal, 4200, 'net total after 50 tk discount = 4200')
eq(cart3.paidTaka, 2000, 'paid 2000')
eq(cart3.dueTaka, 2200, 'remaining due = 4200 - 2000 = 2200 tk recorded in Khata')
eq(cart3.changeTaka, 0, 'change is 0 for credit sale')

// 4. Excessive discount guard (discount cannot exceed gross total)
const cart4 = calculateCart(
  [{ productId: 'p1', name: 'বিস্কুট', unitPrice: 50, qty: 1, unit: 'packet' }],
  100, // Attempted 100 tk discount on 50 tk item
  0,
)
eq(cart4.discountTaka, 50, 'discount clamped to gross total (50)')
eq(cart4.netTotal, 0, 'net total cannot be negative')

/* ── Stock Movement Math ─────────────────────────────────────────────────── */

suite('Inventory Stock Delta & Valuation')

interface InventoryItem {
  id: string
  name: string
  stock: number
  buyPrice: number
  sellPrice: number
}

function applySaleStock(item: InventoryItem, qtySold: number): InventoryItem {
  return {
    ...item,
    stock: Math.max(0, item.stock - qtySold),
  }
}

function applyPurchaseRestock(item: InventoryItem, qtyBought: number, newBuyPrice?: number): InventoryItem {
  return {
    ...item,
    stock: item.stock + qtyBought,
    buyPrice: newBuyPrice !== undefined ? newBuyPrice : item.buyPrice,
  }
}

const itemSugar: InventoryItem = {
  id: 'sugar_1',
  name: 'চিনি',
  stock: 50,
  buyPrice: 120,
  sellPrice: 130,
}

const afterSale = applySaleStock(itemSugar, 15)
eq(afterSale.stock, 35, 'stock decreased by 15')

const afterRestock = applyPurchaseRestock(afterSale, 50, 122)
eq(afterRestock.stock, 85, 'stock replenished to 85')
eq(afterRestock.buyPrice, 122, 'updated buy price to 122')

// Stock valuation calculation
const stockValuationCost = afterRestock.stock * afterRestock.buyPrice
const stockValuationSell = afterRestock.stock * afterRestock.sellPrice
eq(stockValuationCost, 10370, 'valuation at cost = 85 * 122 = 10,370')
eq(stockValuationSell, 11050, 'valuation at sell price = 85 * 130 = 11,050')
eq(stockValuationSell - stockValuationCost, 680, 'projected gross profit = 680')

/* ── Date Bounds & Add Days ──────────────────────────────────────────────── */

suite('Date Bounds & Bangladesh Timezone Windows')

/* ── Money & Compact Formatting ──────────────────────────────────────────── */

suite('Money and Compact Number Formatting')

eq(formatMoney(150, 'bn'), '৳১৫০', 'Bengali taka formatting 150')
eq(formatMoney(12500, 'bn'), '৳১২,৫০০', 'South asian grouping 12,500')
eq(formatMoney(-500, 'bn'), '-৳৫০০', 'Negative money sign outside symbol')
eq(formatMoney(0, 'bn'), '৳০', 'Zero taka')

eq(formatMoneyCompact(5000, 'bn'), '৳৫.০ হাজার', 'Compact 5k in Bengali')
eq(formatMoneyCompact(250000, 'bn'), '৳২.৫ লাখ', 'Compact 2.5 lakh in Bengali')
eq(formatMoneyCompact(15000000, 'bn'), '৳১.৫ কোটি', 'Compact 1.5 crore in Bengali')
eq(formatPercent(12.5, 'bn'), '১২.৫%', 'Bengali percentage 12.5%')
