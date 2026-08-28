import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, Fab, IconButton } from '@/components/ui/Button'
import { Badge, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { SearchInput } from '@/components/ui/Field'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import { listCustomerDues } from '@/data/parties'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { LIMITS, detailPath } from '@/lib/constants'
import type { CustomerDue } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { CollectPaymentSheet } from './CollectPaymentSheet'
import { CustomerSheet } from './CustomerSheet'
import {
  type KhataTab,
  agingTone,
  calculateKhataSummary,
  filterCustomers,
} from './khata-utils'

export default function Khata() {
  const { t, money, num } = useI18n()
  const navigate = useNavigate()

  const [tab, setTab] = useState<KhataTab>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState<number>(LIMITS.pageSize)

  const [addOpen, setAddOpen] = useState(false)
  const [collectCustomer, setCollectCustomer] = useState<CustomerDue | null>(null)

  const customersQuery = useQueryList('party:customers', listCustomerDues, {
    staleMs: 5_000,
    onSync: true,
  })

  const summary = useMemo(
    () => calculateKhataSummary(customersQuery.rows),
    [customersQuery.rows],
  )

  const filtered = useMemo(
    () => filterCustomers(customersQuery.rows, tab, query),
    [customersQuery.rows, tab, query],
  )

  const visible = filtered.slice(0, shown)
  const more = filtered.length - visible.length

  function pickTab(next: KhataTab) {
    setTab(next)
    setShown(LIMITS.pageSize)
  }

  function search(next: string) {
    setQuery(next)
    setShown(LIMITS.pageSize)
  }

  const tabs: SegmentedOption<KhataTab>[] = [
    { value: 'all', label: t('common.all') },
    {
      value: 'due',
      label: t('khata.due'),
      badge: summary.debtorCount > 0 ? num(summary.debtorCount) : undefined,
    },
    {
      value: 'over_limit',
      label: t('khata.overLimit'),
      badge: summary.overLimitCount > 0 ? num(summary.overLimitCount) : undefined,
    },
    {
      value: 'aging_15',
      label: t('khata.aging.d15'),
      badge: summary.agingCounts.d15 > 0 ? num(summary.agingCounts.d15) : undefined,
    },
    {
      value: 'aging_30',
      label: t('khata.aging.d30'),
      badge:
        summary.agingCounts.d30 + summary.agingCounts.d60plus > 0
          ? num(summary.agingCounts.d30 + summary.agingCounts.d60plus)
          : undefined,
    },
  ]

  return (
    <Screen
      title={t('khata.title')}
      actions={
        <>
          <LocaleToggle />
          <IconButton
            name="plus"
            label={t('khata.addCustomer')}
            variant="ghost"
            onClick={() => setAddOpen(true)}
          />
        </>
      }
    >
      {/* ── Summary Hero Card ────────────────────────────────────────────── */}
      <div className="card p-4">
        <span className="text-ink-soft text-sm">{t('khata.totalDue')}</span>
        <p className="tnum text-warn mt-1 text-3xl font-bold">
          {money(summary.totalDue)}
        </p>

        <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
          <span>{t('khata.customers', { count: num(summary.debtorCount) })}</span>
          {summary.overLimitCount > 0 ? (
            <span className="text-warn font-semibold">
              {summary.overLimitCount} {t('khata.overLimit')}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Search & Filter Tabs ─────────────────────────────────────────── */}
      <SearchInput
        value={query}
        onChange={search}
        placeholder={t('common.searchPlaceholder')}
        className="mt-3"
      />

      <Segmented
        value={tab}
        onChange={pickTab}
        options={tabs}
        label={t('common.filter')}
        size="sm"
        className="mt-3"
      />

      {/* ── Customer List ────────────────────────────────────────────────── */}
      <div className="mt-3">
        {customersQuery.loading && customersQuery.rows.length === 0 ? (
          <SkeletonRows rows={5} />
        ) : customersQuery.error ? (
          <ErrorState
            message={customersQuery.error}
            onRetry={() => void customersQuery.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="book"
            title={t('khata.empty')}
            body={query ? t('common.none') : t('khata.emptyHelp')}
            action={{
              label: t('khata.addCustomer'),
              onClick: () => setAddOpen(true),
              icon: 'plus',
            }}
          />
        ) : (
          <ul className="divide-y divide-rule/60 card overflow-hidden">
            {visible.map((c) => {
              const tone = agingTone(c.days_since_payment)
              const hasDue = c.due_balance > 0

              return (
                <li key={c.id}>
                  <div
                    onClick={() => navigate(detailPath('party', c.id))}
                    className="p-3.5 flex items-center justify-between hover:bg-canvas/50 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink text-base truncate">
                          {c.name}
                        </span>
                        {c.over_limit ? (
                          <Badge tone="danger">{t('khata.overLimit')}</Badge>
                        ) : null}
                      </div>

                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
                        {c.phone ? <span>{c.phone}</span> : null}
                        {c.days_since_payment != null && hasDue ? (
                          <span className={cn(tone === 'danger' && 'text-warn font-semibold')}>
                            • {t('khata.sinceDays', { days: num(c.days_since_payment) })}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p
                          className={cn(
                            'tnum font-bold text-base',
                            hasDue
                              ? 'text-warn'
                              : c.due_balance < 0
                                ? 'text-brand'
                                : 'text-ink-soft',
                          )}
                        >
                          {c.due_balance === 0
                            ? '০'
                            : money(Math.abs(c.due_balance))}
                        </p>
                        {c.due_balance < 0 ? (
                          <p className="text-xs text-brand font-medium">
                            {t('khata.advance')}
                          </p>
                        ) : null}
                      </div>

                      {hasDue ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            setCollectCustomer(c)
                          }}
                        >
                          {t('khata.collect')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {more > 0 ? (
          <div className="mt-3 text-center">
            <Button
              variant="outline"
              onClick={() => setShown((prev) => prev + LIMITS.pageSize)}
            >
              {t('common.showMore')} ({num(more)})
            </Button>
          </div>
        ) : null}
      </div>

      <Fab
        name="plus"
        label={t('khata.addCustomer')}
        onClick={() => setAddOpen(true)}
      />

      <CustomerSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        initialName={query}
        onSaved={(c) => {
          void customersQuery.refetch()
          navigate(detailPath('party', c.id))
        }}
      />

      <CollectPaymentSheet
        open={Boolean(collectCustomer)}
        onClose={() => setCollectCustomer(null)}
        customer={collectCustomer}
        onCollected={() => {
          void customersQuery.refetch()
        }}
      />
    </Screen>
  )
}
