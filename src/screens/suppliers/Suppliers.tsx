import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, Fab, IconButton } from '@/components/ui/Button'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { SearchInput } from '@/components/ui/Field'
import { listSupplierDues } from '@/data/parties'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES, detailPath } from '@/lib/constants'
import type { SupplierDue } from '@/lib/database.types'
import { matchesSearch, searchRank } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { PaySupplierSheet } from './PaySupplierSheet'
import { SupplierSheet } from './SupplierSheet'

export default function Suppliers() {
  const { t, money } = useI18n()
  const { can } = useShop()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [paySupplier, setPaySupplier] = useState<SupplierDue | null>(null)

  const suppliers = useQueryList('party:suppliers', listSupplierDues, {
    staleMs: 60_000,
    onSync: true,
  })

  const totalPayable = useMemo(
    () => suppliers.rows.reduce((sum, s) => sum + Math.max(0, s.due_balance), 0),
    [suppliers.rows],
  )

  const filtered = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return suppliers.rows

    return suppliers.rows
      .filter((s) => matchesSearch(trimmed, s.name, s.phone, s.company))
      .slice()
      .sort((a, b) => searchRank(trimmed, a.name, a.phone) - searchRank(trimmed, b.name, b.phone))
  }, [suppliers.rows, query])

  return (
    <Screen
      title={t('supplier.title')}
      back={() => navigate(ROUTES.home)}
      actions={
        <IconButton
          name="plus"
          label={t('supplier.add')}
          variant="ghost"
          onClick={() => setAddOpen(true)}
        />
      }
    >
      <div className="card p-4">
        <span className="text-ink-soft text-sm">{t('supplier.payable')}</span>
        <p className="tnum text-warn mt-1 text-3xl font-bold">
          {money(totalPayable)}
        </p>
      </div>

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t('common.searchPlaceholder')}
        className="mt-3"
      />

      <div className="mt-3">
        {suppliers.loading && suppliers.rows.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : suppliers.error ? (
          <ErrorState message={suppliers.error} onRetry={() => void suppliers.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="user"
            title={t('supplier.empty')}
            body={query ? t('common.none') : undefined}
            action={{
              label: t('supplier.add'),
              onClick: () => setAddOpen(true),
              icon: 'plus',
            }}
          />
        ) : (
          <ul className="divide-y divide-rule/60 card overflow-hidden">
            {filtered.map((s) => (
              <li
                key={s.id}
                onClick={() => navigate(detailPath('supplier', s.id))}
                className="p-3.5 flex items-center justify-between hover:bg-canvas/50 cursor-pointer transition-colors"
              >
                <div className="min-w-0 flex-1 pr-3">
                  <span className="font-semibold text-ink text-base truncate block">
                    {s.name}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-ink-faint mt-0.5">
                    {s.company ? <span>{s.company}</span> : null}
                    {s.phone ? <span>• {s.phone}</span> : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="tnum font-bold text-base text-warn">
                      {money(s.due_balance)}
                    </p>
                  </div>

                  {can('manager') && s.due_balance > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPaySupplier(s)
                      }}
                    >
                      {t('supplier.pay')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Fab
        name="plus"
        label={t('supplier.add')}
        onClick={() => setAddOpen(true)}
      />

      <SupplierSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        initialName={query}
        onSaved={() => void suppliers.refetch()}
      />

      <PaySupplierSheet
        open={Boolean(paySupplier)}
        onClose={() => setPaySupplier(null)}
        supplier={paySupplier}
        onPaid={() => void suppliers.refetch()}
      />
    </Screen>
  )
}
