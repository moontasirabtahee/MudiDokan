import {
  blankExpensesDay,
  blankSalesDay,
  fillDays,
  rollUpProducts,
  summarise,
} from '@/data/reports'
import type { ExpensesDaily, ProductPerformance, SalesDaily } from '@/lib/database.types'
import { close, deepEq, eq, notOk, ok, suite } from './_harness'

/* ── fillDays & Blank Days ────────────────────────────────────────────────── */

suite('fillDays & Blank Days')

const salesData: SalesDaily[] = [
  {
    shop_id: 'shop_1',
    day: '2026-08-01',
    sale_count: 5,
    gross: 1200,
    discount: 50,
    net: 1150,
    collected: 1000,
    credit_given: 150,
    cogs: 900,
    gross_profit: 250,
  },
  {
    shop_id: 'shop_1',
    day: '2026-08-03',
    sale_count: 2,
    gross: 500,
    discount: 0,
    net: 500,
    collected: 500,
    credit_given: 0,
    cogs: 400,
    gross_profit: 100,
  },
]

const filled = fillDays(salesData, '2026-08-01', '2026-08-04', blankSalesDay('shop_1'))
eq(filled.length, 4, 'fills all 4 calendar days in the window')
eq(filled[0].day, '2026-08-01', 'day 1 is present')
eq(filled[0].net, 1150, 'day 1 keeps actual net')
eq(filled[1].day, '2026-08-02', 'day 2 is generated')
eq(filled[1].net, 0, 'day 2 has 0 net sales')
eq(filled[2].day, '2026-08-03', 'day 3 is present')
eq(filled[2].net, 500, 'day 3 keeps actual net')
eq(filled[3].day, '2026-08-04', 'day 4 is generated')
eq(filled[3].net, 0, 'day 4 has 0 net sales')

const expensesData: ExpensesDaily[] = [
  { shop_id: 'shop_1', day: '2026-08-02', total: 300, entry_count: 1 },
]
const filledExp = fillDays(expensesData, '2026-08-01', '2026-08-03', blankExpensesDay('shop_1'))
eq(filledExp.length, 3, 'fills 3 days for expenses')
eq(filledExp[0].total, 0, 'day 1 expense 0')
eq(filledExp[1].total, 300, 'day 2 expense 300')
eq(filledExp[2].total, 0, 'day 3 expense 0')

/* ── rollUpProducts ───────────────────────────────────────────────────────── */

suite('rollUpProducts')

const perfRows: ProductPerformance[] = [
  {
    shop_id: 'shop_1',
    day: '2026-08-01',
    product_id: 'prod_rice',
    product_name: 'মিনিকেট চাল',
    qty_sold: 10,
    revenue: 800,
    cogs: 700,
    profit: 100,
    margin_pct: 12.5,
  },
  {
    shop_id: 'shop_1',
    day: '2026-08-02',
    product_id: 'prod_rice',
    product_name: 'মিনিকেট চাল',
    qty_sold: 15,
    revenue: 1200,
    cogs: 1050,
    profit: 150,
    margin_pct: 12.5,
  },
  {
    shop_id: 'shop_1',
    day: '2026-08-01',
    product_id: 'prod_oil',
    product_name: 'সয়াবিন তেল',
    qty_sold: 5,
    revenue: 900,
    cogs: 800,
    profit: 100,
    margin_pct: 11.11,
  },
  {
    // Loose item without product_id
    shop_id: 'shop_1',
    day: '2026-08-01',
    product_id: null,
    product_name: 'খোলা আটা',
    qty_sold: 2,
    revenue: 100,
    cogs: 80,
    profit: 20,
    margin_pct: 20,
  },
  {
    // Zero revenue edge case
    shop_id: 'shop_1',
    day: '2026-08-02',
    product_id: 'prod_free',
    product_name: 'ফ্রি স্যাম্পল',
    qty_sold: 1,
    revenue: 0,
    cogs: 10,
    profit: -10,
    margin_pct: null,
  },
]

const rolledRevenue = rollUpProducts(perfRows, 'revenue')
eq(rolledRevenue.length, 4, '4 unique products rolled up')
eq(rolledRevenue[0].product_id, 'prod_rice', 'Rice is #1 by revenue')
eq(rolledRevenue[0].qty_sold, 25, 'Rice total qty sold 25')
eq(rolledRevenue[0].revenue, 2000, 'Rice total revenue 2000')
eq(rolledRevenue[0].cogs, 1750, 'Rice total cogs 1750')
eq(rolledRevenue[0].profit, 250, 'Rice total profit 250')
eq(rolledRevenue[0].days, 2, 'Rice sold across 2 days')
close(rolledRevenue[0].margin_pct ?? 0, 12.5, 'Rice margin % correctly recomputed from sums')

const looseItem = rolledRevenue.find((r) => r.product_name === 'খোলা আটা')
ok(looseItem !== undefined, 'loose item retained without product_id')
eq(looseItem?.product_id, null, 'loose item product_id is null')

const freeItem = rolledRevenue.find((r) => r.product_name === 'ফ্রি স্যাম্পল')
eq(freeItem?.margin_pct, null, 'zero revenue item has null margin_pct (avoid division by zero)')

const rolledProfit = rollUpProducts(perfRows, 'profit')
eq(rolledProfit[0].product_name, 'মিনিকেট চাল', 'highest profit product first')

const rolledQty = rollUpProducts(perfRows, 'qty')
eq(rolledQty[0].product_name, 'মিনিকেট চাল', 'highest qty product first')
eq(rolledQty[1].product_name, 'সয়াবিন তেল', 'second qty product')

/* ── summarise ───────────────────────────────────────────────────────────── */

suite('summarise Period Analytics')

const allSales: SalesDaily[] = [
  {
    shop_id: 'shop_1',
    day: '2026-08-01',
    sale_count: 10,
    gross: 5000,
    discount: 200,
    net: 4800,
    collected: 4000,
    credit_given: 800,
    cogs: 3800,
    gross_profit: 1000,
  },
  {
    shop_id: 'shop_1',
    day: '2026-08-02',
    sale_count: 15,
    gross: 7500,
    discount: 500,
    net: 7000,
    collected: 6500,
    credit_given: 500,
    cogs: 5500,
    gross_profit: 1500,
  },
]

const allExpenses: ExpensesDaily[] = [
  { shop_id: 'shop_1', day: '2026-08-01', total: 400, entry_count: 2 },
  { shop_id: 'shop_1', day: '2026-08-02', total: 600, entry_count: 1 },
]

const summary = summarise(allSales, allExpenses, '2026-08-01', '2026-08-04')
eq(summary.days, 4, 'window duration is 4 calendar days')
eq(summary.saleCount, 25, 'total sales count 25')
eq(summary.gross, 12500, 'total gross 12500')
eq(summary.discount, 700, 'total discount 700')
eq(summary.net, 11800, 'total net 11800')
eq(summary.collected, 10500, 'total collected 10500')
eq(summary.creditGiven, 1300, 'total credit given 1300')
eq(summary.cogs, 9300, 'total cogs 9300')
eq(summary.grossProfit, 2500, 'total gross profit 2500')
eq(summary.expenses, 1000, 'total expenses 1000')
eq(summary.netProfit, 1500, 'total net profit (gross profit - expenses) = 1500')
eq(summary.bestDay?.day, '2026-08-02', 'best day identified correctly')
eq(summary.bestDay?.net, 7000, 'best day net amount')
eq(summary.averagePerDay, 2950, 'average per day = 11800 / 4 = 2950')
