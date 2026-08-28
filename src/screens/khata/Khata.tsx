import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, Fab, IconButton } from '@/components/ui/Button'
import { Badge, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { SearchInput } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import { listCustomerDues } from '@/data/parties'
import { useQueryList } from '@/hooks/useQuery'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
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

  const voice = useVoiceRecognition({
    lang: 'bn-BD',
    autoStopMs: 1500,
    onResult: (spoken) => {
      if (spoken.trim()) {
        search(spoken.trim())
      }
    },
  })

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
      <div className="card p-4 bg-gradient-to-br from-surface to-warn-soft/20 border border-rule shadow-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warn-soft text-warn">
              <Icon name="book" size={18} />
            </span>
            <span className="text-ink-soft text-sm font-semibold">{t('khata.totalDue')}</span>
          </div>
          {summary.overLimitCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-danger-soft text-danger text-xs font-bold border border-danger/20">
              <Icon name="alert" size={12} />
              {num(summary.overLimitCount)} {t('khata.overLimit')}
            </span>
          ) : null}
        </div>

        <p className="tnum text-warn mt-2 text-3xl font-extrabold tracking-tight">
          {money(summary.totalDue)}
        </p>

        <div className="mt-2.5 pt-2 border-t border-rule/50 flex items-center justify-between text-xs text-ink-faint">
          <span>{t('khata.customers', { count: num(summary.debtorCount) })}</span>
          <span>মোট খাতা: {num(customersQuery.rows.length)} জন</span>
        </div>
      </div>

      {/* ── Search & Filter Tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 mt-3">
        <div className="flex-1 min-w-0">
          <SearchInput
            value={query}
            onChange={search}
            placeholder={t('common.searchPlaceholder')}
          />
        </div>
        <button
          type="button"
          onClick={() => voice.toggle()}
          title="মুখে বলে কাস্টমার খুঁজুন"
          className={cn(
            'flex h-12 w-12 min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-card border shadow-xs transition-all active:scale-95',
            voice.isListening
              ? 'bg-brand text-white border-brand scale-105 animate-pulse'
              : 'bg-surface border-rule text-brand hover:bg-brand-soft',
          )}
        >
          <Icon name={voice.isListening ? 'mic' : 'micOff'} size={20} />
        </button>
      </div>

      {voice.isListening && (
        <p className="text-center text-xs text-brand font-semibold animate-pulse mt-1.5">
          🎙️ শুনছি... কাস্টমারের নাম বলুন
        </p>
      )}

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
              const initial = (c.name || 'ক').charAt(0).toUpperCase()

              return (
                <li key={c.id}>
                  <div
                    onClick={() => navigate(detailPath('party', c.id))}
                    className="p-3.5 flex items-center justify-between hover:bg-canvas/50 cursor-pointer transition-colors gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-2xs',
                          hasDue
                            ? c.over_limit
                              ? 'bg-danger-soft text-danger border border-danger/30'
                              : 'bg-warn-soft text-warn border border-warn/30'
                            : 'bg-brand-soft text-brand-deep border border-brand/20',
                        )}
                      >
                        {initial}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-ink text-base truncate">
                            {c.name}
                          </span>
                          {c.over_limit ? (
                            <Badge tone="danger">{t('khata.overLimit')}</Badge>
                          ) : null}
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
                          {c.phone ? <span>{c.phone}</span> : null}
                          {c.days_since_payment != null && hasDue ? (
                            <span className={cn(tone === 'danger' ? 'text-danger font-semibold' : 'text-ink-soft')}>
                              • {t('khata.sinceDays', { days: num(c.days_since_payment) })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
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
                            ? '৳০'
                            : money(Math.abs(c.due_balance))}
                        </p>
                        {c.due_balance < 0 ? (
                          <p className="text-[11px] text-brand font-semibold">
                            {t('khata.advance')}
                          </p>
                        ) : c.due_balance === 0 ? (
                          <p className="text-[11px] text-ok font-medium">
                            পরিশোধিত
                          </p>
                        ) : null}
                      </div>

                      {hasDue ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setCollectCustomer(c)
                          }}
                          className="px-3.5 py-2 min-h-[44px] text-xs font-bold rounded-lg bg-warn text-white hover:bg-warn/90 active:scale-95 transition-all shadow-2xs shrink-0 flex items-center justify-center"
                        >
                          {t('khata.collect')}
                        </button>
                      ) : (
                        <span className="text-ink-faint">
                          <Icon name="right" size="sm" />
                        </span>
                      )}
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

