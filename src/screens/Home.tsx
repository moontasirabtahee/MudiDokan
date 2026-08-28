import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getDashboardToday } from '@/data/reports'
import { listRecentSales } from '@/data/transactions'
import { useQuery, useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import type { DashboardToday } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'
import { useShop } from '@/providers/ShopProvider'
import { Screen } from '@/components/layout/AppShell'
import { Button, IconButton } from '@/components/ui/Button'
import { Divider, EmptyState, Row, Section, Skeleton } from '@/components/ui/Feedback'
import { Icon, type IconName } from '@/components/ui/Icon'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import { DailyClosingSheet } from './reports/DailyClosingSheet'

export default function Home() {
  const { t, money, moneyCompact, num, today, when } = useI18n()
  const { displayName } = useAuth()
  const { shopName, can, role } = useShop()
  const navigate = useNavigate()
  const [closingOpen, setClosingOpen] = useState(false)

  const showProfit = can('manager')
  const day = today()

  const dash = useQuery<DashboardToday>('dashboard:today', getDashboardToday, {
    staleMs: 0,
    onSync: true,
  })
  const recent = useQueryList('sales:recent', (shopId) => listRecentSales(shopId, 6), {
    staleMs: 0,
    onSync: true,
  })

  // Refetch when returning to home screen
  useEffect(() => {
    void dash.refetch()
    void recent.refetch()
  }, [])

  const d = dash.data
  const alerts = buildAlerts(d)

  return (
    <Screen
      title={shopName}
      actions={
        <>
          <LocaleToggle />
          <IconButton
            name="refresh"
            label="রিফ্রেশ"
            variant="ghost"
            onClick={() => {
              void dash.refetch()
              void recent.refetch()
            }}
          />
          <IconButton
            name="settings"
            label={t('nav.settings')}
            variant="ghost"
            onClick={() => navigate(ROUTES.settings)}
          />
        </>
      }
    >
      <div className="flex items-center justify-between px-1">
        <p className="text-ink-soft text-sm">{t('home.greeting', { name: displayName })}</p>
        <span
          className={cn(
            'text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs',
            role === 'owner'
              ? 'bg-brand/10 text-brand-deep border border-brand/30'
              : role === 'manager'
                ? 'bg-brand-soft text-brand-deep border border-brand/20'
                : 'bg-canvas text-ink-soft border border-rule',
          )}
        >
          {role === 'owner' ? '👑 মালিক (Owner)' : role === 'manager' ? '👔 ম্যানেজার' : '💼 ক্যাশিয়ার (Cashier)'}
        </span>
      </div>

      {role === 'cashier' && (
        <div className="bg-canvas/80 border border-rule text-xs text-ink-soft px-3 py-2 rounded-card mt-2 flex items-center gap-2">
          <Icon name="check" size="sm" className="text-brand shrink-0" />
          <span>ক্যাশিয়ার মোড: শুধু পণ্য বিক্রি ও বাকির টাকা জমা দেওয়া যাবে।</span>
        </div>
      )}

      {/* ── Today ───────────────────────────────────────────────────────── */}
      <div className="card mt-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-ink-soft text-sm">{t('home.todaySales')}</span>
          <span className="text-ink-faint text-xs">
            {t('common.count')}: {num(d?.sales_count ?? 0)}
          </span>
        </div>

        {dash.loading && !d ? (
          <Skeleton className="mt-2 h-10 w-40" />
        ) : (
          <div className="flex items-baseline gap-2">
            <p className="tnum text-ink mt-1 text-4xl font-bold">{money(d?.sales_total ?? 0)}</p>
            {dash.refreshing && (
              <span
                title="আপডেট হচ্ছে…"
                className="mb-0.5 h-2 w-2 rounded-full bg-brand animate-pulse self-end"
              />
            )}
          </div>
        )}

        {/* Cash actually in hand is takings minus credit given plus dues collected.
            All three come from the view; the arithmetic is not repeated here. */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Metric
            label={t('home.cashInHand')}
            value={money((d?.collected_total ?? 0) + (d?.dues_collected_today ?? 0))}
            tone="ok"
          />
          <Metric
            label={t('khata.due')}
            value={money(d?.credit_given ?? 0)}
            tone={(d?.credit_given ?? 0) > 0 ? 'warn' : 'neutral'}
          />
        </div>

        {showProfit ? (
          <>
            <Divider />
            <div className="grid grid-cols-2 gap-3">
              <Metric
                label={t('home.todayProfit')}
                value={money(d?.net_profit ?? 0)}
                tone={(d?.net_profit ?? 0) < 0 ? 'danger' : 'ok'}
              />
              <Metric label={t('home.todayExpense')} value={money(d?.expenses_total ?? 0)} />
            </div>
          </>
        ) : null}
      </div>

      {/* ── The four things ─────────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <QuickAction to={ROUTES.sell} icon="cart" label={t('home.quickSell')} primary />
        <QuickAction to={ROUTES.khata} icon="book" label={t('home.quickCollect')} />
        <QuickAction to={ROUTES.expenses} icon="cash" label={t('home.quickExpense')} />
        <QuickAction to={ROUTES.purchases} icon="truck" label={t('home.quickPurchase')} />
      </div>

      {/* ── Evening Daily Closing ───────────────────────────────────────── */}
      {showProfit && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setClosingOpen(true)}
            className="w-full flex items-center justify-between p-3 rounded-card bg-surface border border-rule hover:bg-canvas shadow-sm transition-all text-start"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
                <Icon name="moon" size={20} />
              </span>
              <div>
                <p className="text-sm font-bold text-ink">দিনের সমাপনী হিসাব (Daily Closing)</p>
                <p className="text-xs text-ink-soft">ক্যাশ বাক্স ও দিনের হিসাব মেলান</p>
              </div>
            </div>
            <Icon name="right" size="sm" className="text-ink-faint" />
          </button>

          <DailyClosingSheet
            open={closingOpen}
            onClose={() => setClosingOpen(false)}
          />
        </div>
      )}

      {/* ── Attention ───────────────────────────────────────────────────── */}
      <Section title={t('home.alerts')} className="mt-5">
        {alerts.length === 0 ? (
          <div className="text-ink-soft flex items-center gap-2 px-3.5 py-3 text-sm">
            <Icon name="check" className="text-ok" size="sm" />
            {t('home.noAlerts')}
          </div>
        ) : (
          alerts.map((alert, index) => (
            <div key={alert.key}>
              {index > 0 ? <Divider inset /> : null}
              <Row
                onClick={() => navigate(alert.to)}
                leading={
                  <span
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-card',
                      alert.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-ink',
                    )}
                  >
                    <Icon name={alert.icon} size="sm" />
                  </span>
                }
                title={t(alert.key, { count: alert.count })}
                chevron
              />
            </div>
          ))
        )}
      </Section>

      {/* ── What just happened ──────────────────────────────────────────── */}
      <Section
        title={t('home.recentSales')}
        className="mt-4"
        action={
          <Link className="text-brand-deep text-sm font-medium" to={ROUTES.reports}>
            {t('common.seeAll')}
          </Link>
        }
      >
        {recent.rows.length === 0 && !recent.loading ? (
          <EmptyState
            icon="receipt"
            title={t('home.emptyToday')}
            action={{ label: t('home.emptyTodayCta'), onClick: () => navigate(ROUTES.sell), icon: 'plus' }}
          />
        ) : (
          recent.rows.map((sale, index) => (
            <div key={sale.id}>
              {index > 0 ? <Divider inset /> : null}
              <Row
                title={t('sell.invoiceNo', { no: sale.invoice_no })}
                subtitle={when(sale.sold_at)}
                trailing={
                  <span className="tnum font-semibold">{moneyCompact(sale.total)}</span>
                }
                trailingSub={sale.status === 'void' ? t('sell.voided') : undefined}
              />
            </div>
          ))
        )}
      </Section>

      {/* Stock value is the quietest number here and the one that surprises people:
          most shopkeepers have never seen what is sitting on their shelves. */}
      {showProfit && d ? (
        <Button
          variant="ghost"
          block
          className="mt-4"
          icon="box"
          onClick={() => navigate(ROUTES.stock)}
        >
          {t('home.stockValue')}: {money(d.stock_value_at_cost)}
        </Button>
      ) : null}

      <p className="text-ink-faint mt-6 text-center text-xs">{day}</p>
    </Screen>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'ok' | 'warn' | 'danger'
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-ink'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-ink'
  return (
    <div>
      <p className="text-ink-faint text-xs">{label}</p>
      <p className={cn('tnum text-lg font-semibold', toneClass)}>{value}</p>
    </div>
  )
}

/**
 * The four buttons that cover nearly every reason to open this app.
 *
 * Deliberately large, deliberately labelled with verbs. "বিক্রি করুন" is an
 * instruction; "Sales" is a category, and a category is something you have to
 * translate into an action before you can tap it.
 */
function QuickAction({
  to,
  icon,
  label,
  primary = false,
}: {
  to: string
  icon: IconName
  label: string
  primary?: boolean
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex min-h-[4rem] items-center gap-3.5 rounded-card px-4 py-3.5 text-base font-semibold border transition-all active:scale-[0.98]',
        primary
          ? 'bg-brand text-white border-brand shadow-card hover:bg-brand-deep'
          : 'bg-surface text-ink border-rule/80 shadow-card hover:bg-canvas/60',
      )}
    >
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl shrink-0', primary ? 'bg-white/20 text-white' : 'bg-brand-soft text-brand')}>
        <Icon name={icon} size="md" />
      </span>
      <span className="leading-tight">{label}</span>
    </Link>
  )
}

/* ── Alerts ─────────────────────────────────────────────────────────────── */

interface Alert {
  key: 'home.outOfStockAlert' | 'home.lowStockAlert' | 'home.expiringAlert' | 'home.duesAlert'
  count: number
  icon: IconName
  tone: 'warn' | 'danger'
  to: string
}

/**
 * Built from counts the view already computed, and ordered by how much money is at
 * risk rather than by severity of wording: an empty shelf is a sale that cannot
 * happen, so it leads. Nothing here is invented — a zero count produces no row,
 * because an alert list that always has four items in it is a list nobody reads.
 */
function buildAlerts(d: DashboardToday | null | undefined): Alert[] {
  if (!d) return []
  const alerts: Alert[] = []
  if (d.out_of_stock_count > 0) {
    alerts.push({
      key: 'home.outOfStockAlert',
      count: d.out_of_stock_count,
      icon: 'alert',
      tone: 'danger',
      to: ROUTES.stock,
    })
  }
  if (d.low_stock_count > 0) {
    alerts.push({
      key: 'home.lowStockAlert',
      count: d.low_stock_count,
      icon: 'box',
      tone: 'warn',
      to: ROUTES.stock,
    })
  }
  if (d.customers_with_dues > 0) {
    alerts.push({
      key: 'home.duesAlert',
      count: d.customers_with_dues,
      icon: 'book',
      tone: 'warn',
      to: ROUTES.khata,
    })
  }
  if (d.expiring_soon_count > 0) {
    alerts.push({
      key: 'home.expiringAlert',
      count: d.expiring_soon_count,
      icon: 'clock',
      tone: 'warn',
      to: ROUTES.stock,
    })
  }
  return alerts
}
