import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Fab, IconButton } from '@/components/ui/Button'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import { listExpenses } from '@/data/transactions'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { EXPENSE_CATEGORIES, ROUTES } from '@/lib/constants'
import { addDays } from '@/lib/format'
import { useShop } from '@/providers/ShopProvider'
import { ExpenseSheet } from './ExpenseSheet'

type ExpenseRange = 'today' | 'week' | 'month'

export default function Expenses() {
  const { t, locale, timeZone, money, today } = useI18n()
  const { can } = useShop()
  const navigate = useNavigate()

  const [range, setRange] = useState<ExpenseRange>('today')
  const [sheetOpen, setSheetOpen] = useState(false)

  const currentDay = today()

  const { fromDay, toDay } = useMemo(() => {
    if (range === 'today') return { fromDay: currentDay, toDay: currentDay }
    if (range === 'week') return { fromDay: addDays(currentDay, -7), toDay: currentDay }
    return { fromDay: addDays(currentDay, -30), toDay: currentDay }
  }, [range, currentDay])

  const expenses = useQueryList(
    `expenses:${fromDay}:${toDay}`,
    (shopId) => listExpenses(shopId, fromDay, toDay, timeZone),
    { staleMs: 60_000, onSync: true },
  )

  const total = useMemo(
    () => expenses.rows.reduce((sum, e) => sum + e.amount, 0),
    [expenses.rows],
  )

  const tabs: SegmentedOption<ExpenseRange>[] = [
    { value: 'today', label: t('common.today') },
    { value: 'week', label: t('common.last7') },
    { value: 'month', label: t('common.thisMonth') },
  ]

  return (
    <Screen
      title={t('expense.title')}
      back={() => navigate(ROUTES.home)}
      actions={
        can('manager') ? (
          <IconButton
            name="plus"
            label={t('expense.add')}
            variant="ghost"
            onClick={() => setSheetOpen(true)}
          />
        ) : undefined
      }
    >
      <div className="card p-4">
        <span className="text-ink-soft text-sm">
          {range === 'today' ? t('expense.today') : t('expense.title')}
        </span>
        <p className="tnum text-warn mt-1 text-3xl font-bold">{money(total)}</p>
      </div>

      <Segmented
        value={range}
        onChange={setRange}
        options={tabs}
        label={t('common.filter')}
        size="sm"
        className="mt-3"
      />

      <div className="mt-3">
        {expenses.loading && expenses.rows.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : expenses.error ? (
          <ErrorState message={expenses.error} onRetry={() => void expenses.refetch()} />
        ) : expenses.rows.length === 0 ? (
          <EmptyState
            icon="chart"
            title={t('expense.empty')}
            body={t('expense.emptyHelp')}
            action={
              can('manager')
                ? {
                    label: t('expense.add'),
                    onClick: () => setSheetOpen(true),
                    icon: 'plus',
                  }
                : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-rule/60 card overflow-hidden">
            {expenses.rows.map((e) => {
              const cat = EXPENSE_CATEGORIES[e.category]
              return (
                <li key={e.id} className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{cat?.icon || '•'}</span>
                    <div>
                      <p className="font-semibold text-sm text-ink">
                        {cat ? cat[locale] : e.category}
                      </p>
                      {e.note ? <p className="text-xs text-ink-faint">{e.note}</p> : null}
                    </div>
                  </div>

                  <p className="tnum font-bold text-base text-ink">{money(e.amount)}</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {can('manager') ? (
        <Fab
          name="plus"
          label={t('expense.add')}
          onClick={() => setSheetOpen(true)}
        />
      ) : null}

      <ExpenseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={() => void expenses.refetch()}
      />
    </Screen>
  )
}
