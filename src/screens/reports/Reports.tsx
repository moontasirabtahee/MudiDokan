import { useMemo, useState } from 'react'
import { Screen } from '@/components/layout/AppShell'
import { Divider, EmptyState, Row, SkeletonRows } from '@/components/ui/Feedback'
import { AmountField } from '@/components/ui/NumberField'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import {
  getDailyClosing,
  listExpensesDaily,
  listProductPerformance,
  listSalesDaily,
  rollUpProducts,
  summarise,
} from '@/data/reports'
import { useQuery, useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import type { DailyClosing } from '@/lib/database.types'
import { addDays } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'

type ReportRange = 'today' | 'last7' | 'last30'
type ReportTab = 'summary' | 'closing' | 'products'

export default function Reports() {
  const { t, money, num, today } = useI18n()
  const { can } = useShop()

  const [tab, setTab] = useState<ReportTab>('summary')
  const [range, setRange] = useState<ReportRange>('last7')
  const [countedCash, setCountedCash] = useState<number | null>(null)

  const isManager = can('manager')
  const currentDay = today()

  const { fromDay, toDay } = useMemo(() => {
    if (range === 'today') return { fromDay: currentDay, toDay: currentDay }
    if (range === 'last7') return { fromDay: addDays(currentDay, -7), toDay: currentDay }
    return { fromDay: addDays(currentDay, -30), toDay: currentDay }
  }, [range, currentDay])

  const salesQuery = useQueryList(
    `reports:sales:${fromDay}:${toDay}`,
    (shopId) => listSalesDaily(shopId, fromDay, toDay),
    { staleMs: 60_000, onSync: true },
  )

  const expensesQuery = useQueryList(
    `reports:expenses:${fromDay}:${toDay}`,
    (shopId) => listExpensesDaily(shopId, fromDay, toDay),
    { staleMs: 60_000, onSync: true },
  )

  const closingQuery = useQuery<DailyClosing>(
    tab === 'closing' ? `reports:closing:${currentDay}` : null,
    (shopId) => getDailyClosing(shopId, currentDay, countedCash),
    { staleMs: 30_000, onSync: true },
  )

  const productsQuery = useQueryList(
    tab === 'products' ? `reports:products:${fromDay}:${toDay}` : null,
    (shopId) => listProductPerformance(shopId, fromDay, toDay),
    { staleMs: 60_000, onSync: true },
  )

  const summary = useMemo(
    () => summarise(salesQuery.rows, expensesQuery.rows, fromDay, toDay),
    [salesQuery.rows, expensesQuery.rows, fromDay, toDay],
  )

  const productRows = useMemo(
    () => rollUpProducts(productsQuery.rows),
    [productsQuery.rows],
  )

  const closing = closingQuery.data
  const expectedCash = closing?.expected_cash ?? 0
  const counted = countedCash ?? expectedCash
  const variance = counted - expectedCash
  const marginPct = summary.net > 0 ? Math.round((summary.grossProfit / summary.net) * 100) : 0

  const tabs: SegmentedOption<ReportTab>[] = [
    { value: 'summary', label: t('report.title') },
    { value: 'closing', label: t('report.closing') },
    { value: 'products', label: t('report.products') },
  ]

  const rangeOptions: SegmentedOption<ReportRange>[] = [
    { value: 'today', label: t('common.today') },
    { value: 'last7', label: t('common.last7') },
    { value: 'last30', label: t('common.last30') },
  ]

  return (
    <Screen title={t('report.title')}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={tabs}
        label={t('common.filter')}
        size="sm"
      />

      {tab !== 'closing' ? (
        <Segmented
          value={range}
          onChange={setRange}
          options={rangeOptions}
          label={t('common.date')}
          size="sm"
          className="mt-3"
        />
      ) : null}

      {/* ── Summary Tab ─────────────────────────────────────────────────── */}
      {tab === 'summary' ? (
        <div className="mt-3 space-y-3">
          <div className="card p-4">
            <span className="text-ink-soft text-sm">{t('report.revenue')}</span>
            <p className="tnum text-ink mt-1 text-3xl font-bold">
              {money(summary.net)}
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
              <span>{t('home.saleCount', { count: num(summary.saleCount) })}</span>
              <span>{t('home.cashInHand')}: {money(summary.collected)}</span>
            </div>
          </div>

          {isManager ? (
            <div className="card p-4 space-y-2.5">
              <Row
                title={t('report.cogs')}
                trailing={<span className="tnum text-ink-soft">{money(summary.cogs)}</span>}
              />
              <Row
                title={t('report.grossProfit')}
                trailing={
                  <span className="tnum font-bold text-brand">{money(summary.grossProfit)}</span>
                }
              />
              <Row
                title={t('report.expenses')}
                trailing={<span className="tnum text-warn">{money(summary.expenses)}</span>}
              />
              <Divider />
              <Row
                title={t('report.netProfit')}
                trailing={
                  <span className="tnum font-extrabold text-lg text-brand">
                    {money(summary.netProfit)}
                  </span>
                }
              />
              <Row
                title={t('report.marginPct')}
                trailing={<span className="tnum font-semibold">{num(marginPct)}%</span>}
              />
            </div>
          ) : null}

          <div className="card p-4 space-y-2">
            <Row
              title={t('report.creditGiven')}
              trailing={<span className="tnum text-warn font-semibold">{money(summary.creditGiven)}</span>}
            />
            <Row
              title={t('report.duesCollected')}
              trailing={<span className="tnum text-brand font-semibold">{money(summary.collected)}</span>}
            />
          </div>
        </div>
      ) : null}

      {/* ── Daily Closing Tab ────────────────────────────────────────────── */}
      {tab === 'closing' ? (
        <div className="mt-3 space-y-3">
          <div className="card p-4">
            <p className="text-ink-soft text-sm">{t('report.closingHelp')}</p>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="p-3 bg-canvas rounded-card">
                <span className="text-xs text-ink-soft">{t('report.expectedCash')}</span>
                <p className="tnum font-bold text-xl text-ink mt-1">{money(expectedCash)}</p>
              </div>

              <div className="p-3 bg-canvas rounded-card">
                <span className="text-xs text-ink-soft">{t('report.variance')}</span>
                <p
                  className={cn(
                    'tnum font-bold text-xl mt-1',
                    variance === 0
                      ? 'text-brand'
                      : variance < 0
                        ? 'text-warn'
                        : 'text-amber-500',
                  )}
                >
                  {variance === 0
                    ? t('report.varianceOk')
                    : money(variance)}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <AmountField
                value={countedCash}
                onChange={setCountedCash}
                placeholder={money(expectedCash)}
              />
            </div>
          </div>

          <div className="card p-3 space-y-2 text-sm">
            <Row
              title={t('home.todaySales')}
              trailing={<span className="tnum">{money(closing?.sales_total ?? 0)}</span>}
            />
            <Row
              title={t('report.creditGiven')}
              trailing={<span className="tnum text-warn">{money(closing?.credit_given ?? 0)}</span>}
            />
            <Row
              title={t('report.duesCollected')}
              trailing={
                <span className="tnum text-brand">
                  {money((closing?.dues_collected_cash ?? 0) + (closing?.dues_collected_digital ?? 0))}
                </span>
              }
            />
            <Row
              title={t('home.todayExpense')}
              trailing={<span className="tnum text-warn">{money(closing?.expenses ?? 0)}</span>}
            />
          </div>
        </div>
      ) : null}

      {/* ── Products Performance Tab ────────────────────────────────────── */}
      {tab === 'products' ? (
        <div className="mt-3">
          {productsQuery.loading && productRows.length === 0 ? (
            <SkeletonRows rows={5} />
          ) : productRows.length === 0 ? (
            <EmptyState icon="chart" title={t('report.empty')} />
          ) : (
            <ul className="divide-y divide-rule/60 card overflow-hidden">
              {productRows.map((p) => (
                <li key={p.product_id ?? p.product_name} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-ink truncate">{p.product_name}</p>
                    <p className="text-xs text-ink-faint truncate">
                      {t('report.qtySold')}: {num(p.qty_sold)} • {t('report.revenue')}: {money(p.revenue)}
                    </p>
                  </div>

                  {isManager ? (
                    <div className="text-right shrink-0">
                      <p className="tnum font-bold text-sm text-brand">{money(p.profit)}</p>
                      {p.margin_pct != null ? (
                        <p className="text-xs text-ink-faint">{num(Math.round(p.margin_pct))}%</p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Screen>
  )
}
