import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Badge, ErrorState, Row, SkeletonRows } from '@/components/ui/Feedback'
import { getPurchase } from '@/data/transactions'
import { useQuery } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import type { PurchaseWithItems } from '@/data/transactions'

export default function PurchaseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, money, num, qty: fmtQty, when } = useI18n()

  const purchaseQuery = useQuery<PurchaseWithItems>(
    id ? `purchase:${id}` : null,
    () => getPurchase(id!),
    { staleMs: 60_000, onSync: true },
  )

  const purchase = purchaseQuery.data

  if (purchaseQuery.loading && !purchase) {
    return (
      <Screen title={t('purchase.title')} back={() => navigate(ROUTES.purchases)}>
        <SkeletonRows rows={4} />
      </Screen>
    )
  }

  if (!purchase) {
    return (
      <Screen title={t('purchase.title')} back={() => navigate(ROUTES.purchases)}>
        <ErrorState message={purchaseQuery.error ?? t('error.notFound')} />
      </Screen>
    )
  }

  return (
    <Screen title={t('purchase.title')} back={() => navigate(ROUTES.purchases)}>
      <div className="card p-4 mb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-bold text-lg text-ink">
              {t('sell.invoiceNo', { no: num(purchase.invoice_no) })}
            </p>
            <p className="text-xs text-ink-faint">
              {when(purchase.purchased_at)}
            </p>
          </div>

          <Badge tone={purchase.due > 0 ? 'warn' : 'ok'}>
            {purchase.due > 0 ? t('khata.due') : t('sell.paid')}
          </Badge>
        </div>

        {purchase.supplier ? (
          <div className="mt-3 pt-3 border-t border-rule/60 text-sm">
            <span className="text-ink-soft">{t('purchase.supplier')}: </span>
            <span className="font-semibold text-ink">{purchase.supplier.name}</span>
            {purchase.supplier.company ? (
              <span className="text-xs text-ink-faint"> ({purchase.supplier.company})</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card p-3 mb-3">
        <h3 className="font-semibold text-sm text-ink mb-2">{t('nav.products')}</h3>
        <ul className="divide-y divide-rule/60">
          {purchase.items.map((item) => (
            <li key={item.id} className="py-2 flex items-center justify-between text-sm">
              <div>
                <p className="font-medium text-ink">
                  {item.product?.name_bn || item.product?.name || '—'}
                </p>
                <p className="text-xs text-ink-faint">
                  {fmtQty(item.qty, item.unit)} × {money(item.unit_cost)}
                </p>
              </div>
              <p className="tnum font-semibold text-ink">{money(item.line_total)}</p>
            </li>
          ))}
        </ul>

        <div className="mt-3 pt-3 border-t border-rule/60 space-y-1 text-sm">
          <Row title={t('common.total')} trailing={<span className="font-bold">{money(purchase.total)}</span>} />
          <Row title={t('sell.paid')} trailing={<span className="text-brand font-semibold">{money(purchase.paid)}</span>} />
          {purchase.due > 0 ? (
            <Row title={t('khata.due')} trailing={<span className="text-warn font-semibold">{money(purchase.due)}</span>} />
          ) : null}
        </div>
      </div>
    </Screen>
  )
}
