import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { getSupplierDue, listPartyLedger } from '@/data/parties'
import { useQuery, useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import type { PartyLedgerEntry, SupplierDue } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { PaySupplierSheet } from './PaySupplierSheet'
import { SupplierSheet } from './SupplierSheet'

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, money, date } = useI18n()
  const { can } = useShop()

  const [payOpen, setPayOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const supplierQuery = useQuery<SupplierDue>(
    id ? `supplier:${id}` : null,
    () => getSupplierDue(id!),
    { staleMs: 30_000, onSync: true },
  )

  const ledgerQuery = useQueryList<PartyLedgerEntry>(
    id ? `supplier:ledger:${id}` : null,
    () => listPartyLedger('supplier', id!),
    { staleMs: 30_000, onSync: true },
  )

  const supplier = supplierQuery.data

  if (supplierQuery.loading && !supplier) {
    return (
      <Screen title={t('supplier.title')} back={() => navigate(ROUTES.suppliers)}>
        <SkeletonRows rows={4} />
      </Screen>
    )
  }

  if (!supplier) {
    return (
      <Screen title={t('supplier.title')} back={() => navigate(ROUTES.suppliers)}>
        <ErrorState message={supplierQuery.error ?? t('error.notFound')} />
      </Screen>
    )
  }

  const due = supplier.due_balance

  return (
    <Screen
      title={supplier.name}
      back={() => navigate(ROUTES.suppliers)}
      actions={
        <IconButton
          name="settings"
          label={t('common.edit')}
          variant="ghost"
          onClick={() => setEditOpen(true)}
        />
      }
      footer={
        due > 0 && can('manager') ? (
          <Button
            block
            size="lg"
            variant="primary"
            icon="check"
            onClick={() => setPayOpen(true)}
          >
            {t('supplier.pay')}
          </Button>
        ) : undefined
      }
    >
      <div className="card p-4">
        <span className="text-ink-soft text-sm">{t('supplier.payable')}</span>
        <p
          className={cn(
            'tnum mt-1 text-3xl font-bold',
            due > 0 ? 'text-warn' : 'text-ink-soft',
          )}
        >
          {money(due)}
        </p>

        {supplier.company ? (
          <p className="mt-2 text-sm font-medium text-ink">{supplier.company}</p>
        ) : null}

        <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
          {supplier.phone ? (
            <a
              href={`tel:${supplier.phone}`}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-brand-soft text-brand font-bold hover:bg-brand/20 active:scale-95 transition-all text-xs"
            >
              📞 {supplier.phone}
            </a>
          ) : (
            <span>—</span>
          )}
          {supplier.address ? <span>{supplier.address}</span> : null}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-ink-soft px-1 mb-2">
          {t('khata.history')}
        </h3>

        <div className="card overflow-hidden">
          {ledgerQuery.loading && ledgerQuery.rows.length === 0 ? (
            <SkeletonRows rows={3} />
          ) : ledgerQuery.rows.length === 0 ? (
            <EmptyState
              icon="book"
              title={t('khata.history')}
              body={t('khata.emptyHelp')}
            />
          ) : (
            <ul className="divide-y divide-rule/60">
              {ledgerQuery.rows.map((entry) => {
                const isDebit =
                  entry.entry_type === 'credit_purchase' ||
                  entry.entry_type === 'opening_balance' ||
                  entry.entry_type === 'adjustment'
                return (
                  <li key={entry.id} className="p-3">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-center gap-2">
                        <Badge tone={isDebit ? 'warn' : 'ok'}>
                          {entry.entry_type === 'credit_purchase'
                            ? t('purchase.title')
                            : entry.entry_type === 'payment_made'
                              ? t('supplier.pay')
                              : entry.entry_type === 'opening_balance'
                                ? t('khata.openingBalance')
                                : entry.entry_type}
                        </Badge>
                        <span className="text-ink-faint text-xs">
                          {date(entry.occurred_at, { short: true })}
                        </span>
                      </div>

                      <span
                        className={cn(
                          'tnum font-bold text-base',
                          isDebit ? 'text-warn' : 'text-brand',
                        )}
                      >
                        {isDebit ? '+' : '-'}{money(Math.abs(entry.amount))}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-soft">
                      <span className="truncate min-w-0 flex-1">{entry.note || ''}</span>
                      <span className="tnum shrink-0">
                        {t('stock.balanceAfter')}: {money(entry.balance_after)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <PaySupplierSheet
        open={payOpen}
        onClose={() => setPayOpen(false)}
        supplier={supplier}
        onPaid={() => {
          void supplierQuery.refetch()
          void ledgerQuery.refetch()
        }}
      />

      <SupplierSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        supplier={supplier}
        onSaved={() => {
          void supplierQuery.refetch()
        }}
      />
    </Screen>
  )
}
