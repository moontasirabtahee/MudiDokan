import type {
  DailyClosing,
  DashboardToday,
  ExpensesDaily,
  ProductPerformance,
  SalesDaily,
} from '@/lib/database.types'
import { LIMITS } from '@/lib/constants'
import { addDays } from '@/lib/format'
import { rpc, supabase, unwrap } from '@/lib/supabase'

/**
 * Reports: the numbers a shopkeeper closes the day with.
 *
 * Every figure here is computed in Postgres, in views and one function, and this
 * module only fetches them. That division is the whole point. Profit is a claim
 * about money, and a claim about money computed twice — once in SQL for the report
 * and once in TypeScript for the dashboard card — is a claim that will eventually
 * disagree with itself in front of the person who trusted it. There is one
 * definition of gross profit in this system and it lives in `v_sales_daily`.
 *
 * ## Why the day filters are strings and not timestamps
 *
 * The report views group by the shop's business day, already converted to the
 * shop's timezone inside the view. So the `day` column really is a date, and
 * `gte('day', from)` compares dates to dates with no zone arithmetic anywhere near
 * it. This is the payoff for having done that conversion in SQL: the transaction
 * lists in `data/transactions.ts` have to widen and re-filter because they read raw
 * `timestamptz` columns, and nothing here does.
 *
 * ## What a cashier may not see
 *
 * Cost price is not a cashier's business — it is what the owner pays, and in a shop
 * where the cashier is often a nephew or a neighbour, showing it changes a
 * relationship. RLS enforces that on `v_sales_daily`, `v_product_performance` and
 * the profit columns of `v_dashboard_today`; the screens hide the cards as well, so
 * a cashier sees an app with no profit in it rather than an app full of refusals.
 */

/* ── Dashboard ──────────────────────────────────────────────────────────── */

/**
 * One row, everything the home screen needs.
 *
 * `maybeSingle` because a shop that has existed for four minutes and sold nothing
 * has no row in the underlying aggregate, and "no sales yet" is the correct answer
 * to that, not an error. The dashboard renders zeroes and a hint to make the first
 * sale.
 */
export async function getDashboardToday(shopId: string): Promise<DashboardToday | null> {
  return unwrap(supabase.from('v_dashboard_today').select('*').eq('shop_id', shopId).maybeSingle())
}

/* ── Trends ─────────────────────────────────────────────────────────────── */

/**
 * Daily sales for a window, oldest first.
 *
 * Ascending, unlike every list in this app, because the consumer is a chart and a
 * chart reads left to right. Sorting it again in the component would be a second
 * place to get it wrong.
 *
 * Days with no sales are simply absent — the view groups over rows that exist. Any
 * chart that needs a continuous axis has to fill the gaps itself, which
 * `fillDays` below does.
 */
export async function listSalesDaily(
  shopId: string,
  fromDay: string,
  toDay: string,
): Promise<SalesDaily[]> {
  return unwrap(
    supabase
      .from('v_sales_daily')
      .select('*')
      .eq('shop_id', shopId)
      .gte('day', fromDay)
      .lte('day', toDay)
      .order('day', { ascending: true }),
  )
}

export async function listExpensesDaily(
  shopId: string,
  fromDay: string,
  toDay: string,
): Promise<ExpensesDaily[]> {
  return unwrap(
    supabase
      .from('v_expenses_daily')
      .select('*')
      .eq('shop_id', shopId)
      .gte('day', fromDay)
      .lte('day', toDay)
      .order('day', { ascending: true }),
  )
}

/**
 * Turn a sparse series into one row per day.
 *
 * A sales chart with the quiet days missing is not a quieter chart, it is a
 * flattering one: four bars across a week of trading reads as four good days
 * instead of three bad ones. The zeroes have to be visible.
 *
 * Generic over anything with a `day`, so the same fill serves sales and expenses.
 */
export function fillDays<T extends { day: string }>(
  rows: T[],
  fromDay: string,
  toDay: string,
  blank: (day: string) => T,
): T[] {
  const byDay = new Map(rows.map((row) => [row.day, row]))
  const out: T[] = []
  let day = fromDay
  // Bounded by the window the caller asked for, and guarded, because a reversed
  // range would otherwise walk forward forever.
  for (let guard = 0; day <= toDay && guard < 400; guard += 1) {
    out.push(byDay.get(day) ?? blank(day))
    day = addDays(day, 1)
  }
  return out
}

export function blankSalesDay(shopId: string) {
  return (day: string): SalesDaily => ({
    shop_id: shopId,
    day,
    sale_count: 0,
    gross: 0,
    discount: 0,
    net: 0,
    collected: 0,
    credit_given: 0,
    cogs: 0,
    gross_profit: 0,
  })
}

export function blankExpensesDay(shopId: string) {
  return (day: string): ExpensesDaily => ({ shop_id: shopId, day, total: 0, entry_count: 0 })
}

/* ── Product performance ────────────────────────────────────────────────── */

/**
 * What actually sold, per product per day, over a window.
 *
 * Returned raw rather than pre-aggregated because the same fetch answers two
 * different questions — "what are my best sellers this month" and "how is rice
 * moving day by day" — and rolling it up on the server would answer only the
 * first. `rollUpProducts` does the first from these rows.
 */
export async function listProductPerformance(
  shopId: string,
  fromDay: string,
  toDay: string,
): Promise<ProductPerformance[]> {
  return unwrap(
    supabase
      .from('v_product_performance')
      .select('*')
      .eq('shop_id', shopId)
      .gte('day', fromDay)
      .lte('day', toDay)
      .order('day', { ascending: false })
      .limit(LIMITS.catalogMax * 2),
  )
}

export interface ProductTotal {
  product_id: string | null
  product_name: string
  qty_sold: number
  revenue: number
  cogs: number
  profit: number
  margin_pct: number | null
  days: number
}

/**
 * Collapse the daily rows into one line per product, best seller first.
 *
 * Keyed by `product_id ?? product_name`, because a sale line can name a product
 * that no longer exists — a deleted line, or a loose item typed straight into the
 * cart. Those keep their name and group under it, which is what a shopkeeper
 * expects: "চিনি" is চিনি whether or not it is still in the catalogue.
 *
 * Margin is recomputed from the summed revenue and cost rather than averaged from
 * the daily percentages, because the mean of ratios is not the ratio of sums and
 * only one of those two is the margin.
 */
export function rollUpProducts(rows: ProductPerformance[], by: 'revenue' | 'profit' | 'qty' = 'revenue'): ProductTotal[] {
  const totals = new Map<string, ProductTotal>()
  for (const row of rows) {
    const key = row.product_id ?? `name:${row.product_name}`
    const entry = totals.get(key)
    if (entry) {
      entry.qty_sold += row.qty_sold
      entry.revenue += row.revenue
      entry.cogs += row.cogs
      entry.profit += row.profit
      entry.days += 1
    } else {
      totals.set(key, {
        product_id: row.product_id,
        product_name: row.product_name,
        qty_sold: row.qty_sold,
        revenue: row.revenue,
        cogs: row.cogs,
        profit: row.profit,
        margin_pct: null,
        days: 1,
      })
    }
  }

  const out = [...totals.values()]
  for (const entry of out) {
    entry.margin_pct = entry.revenue > 0 ? (entry.profit / entry.revenue) * 100 : null
  }
  const key = by === 'qty' ? 'qty_sold' : by
  out.sort((a, b) => b[key] - a[key])
  return out
}

/* ── Closing ────────────────────────────────────────────────────────────── */

/**
 * The end-of-day count.
 *
 * A read, despite being an RPC: `daily_closing` computes the day's cash position
 * and, when given a counted amount, the variance against it. It writes nothing —
 * which is why it is safe to call from a report screen and why it does not belong
 * in the outbox.
 *
 * `countedCash` is what the shopkeeper found in the drawer. Passing it turns the
 * report from "here is what today should have earned" into "here is the ৳৪০ that
 * is missing", and that second question is the one that finds the leak. Left null,
 * `variance` comes back null and the screen asks for a count.
 */
export async function getDailyClosing(
  shopId: string,
  day: string,
  countedCash: number | null = null,
): Promise<DailyClosing> {
  return rpc('daily_closing', {
    p_shop_id: shopId,
    p_day: day,
    p_counted_cash: countedCash,
  })
}

/* ── Summaries over a window ────────────────────────────────────────────── */

export interface PeriodSummary {
  fromDay: string
  toDay: string
  days: number
  saleCount: number
  gross: number
  discount: number
  net: number
  collected: number
  creditGiven: number
  cogs: number
  grossProfit: number
  expenses: number
  netProfit: number
  bestDay: SalesDaily | null
  averagePerDay: number
}

/**
 * Add up a window into the shape the reports header shows.
 *
 * `days` counts the length of the window, not the number of days that had sales,
 * because "৳১২,০০০ over seven days" is the sentence a shopkeeper is trying to
 * form, and dividing by the three days he happened to be open would inflate it.
 *
 * Net profit is gross profit minus expenses, and expenses are a separate table —
 * so this is the one place the two series meet. It is arithmetic on numbers the
 * database computed, not a second definition of them.
 */
export function summarise(
  sales: SalesDaily[],
  expenses: ExpensesDaily[],
  fromDay: string,
  toDay: string,
): PeriodSummary {
  const summary: PeriodSummary = {
    fromDay,
    toDay,
    days: 0,
    saleCount: 0,
    gross: 0,
    discount: 0,
    net: 0,
    collected: 0,
    creditGiven: 0,
    cogs: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    bestDay: null,
    averagePerDay: 0,
  }

  for (const row of sales) {
    summary.saleCount += row.sale_count
    summary.gross += row.gross
    summary.discount += row.discount
    summary.net += row.net
    summary.collected += row.collected
    summary.creditGiven += row.credit_given
    summary.cogs += row.cogs
    summary.grossProfit += row.gross_profit
    if (!summary.bestDay || row.net > summary.bestDay.net) summary.bestDay = row
  }
  for (const row of expenses) summary.expenses += row.total

  summary.netProfit = summary.grossProfit - summary.expenses

  let day = fromDay
  for (let guard = 0; day <= toDay && guard < 400; guard += 1) {
    summary.days += 1
    day = addDays(day, 1)
  }
  summary.averagePerDay = summary.days > 0 ? summary.net / summary.days : 0

  return summary
}
