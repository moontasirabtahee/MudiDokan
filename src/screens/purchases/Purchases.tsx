import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, Fab } from '@/components/ui/Button'
import { Badge, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { listPurchases } from '@/data/transactions'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES, detailPath } from '@/lib/constants'
import { useShop } from '@/providers/ShopProvider'

export default function Purchases() {
  const { t, money, num, date } = useI18n()
  const { can } = useShop()
  const navigate = useNavigate()

  const purchases = useQueryList('purchases:list', (shopId) => listPurchases(shopId, 40), {
    staleMs: 60_000,
    onSync: true,
  })

  return (
    <Screen
      title={t('purchase.title')}
      back={() => navigate(ROUTES.home)}
      actions={
        can('manager') ? (
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            onClick={() => navigate('/purchases/new')}
          >
            {t('purchase.new')}
          </Button>
        ) : undefined
      }
    >
      <div className="bg-canvas border border-rule text-xs text-ink-soft px-3 py-2.5 rounded-card mt-1 mb-3 flex items-center gap-2">
        <Icon name="truck" size="sm" className="text-brand shrink-0" />
        <span>মহাজন বা ডিলার থেকে পাইকারি পণ্য কিনলে চালানের হিসাব লিখুন — স্টক বৃদ্ধি পাবে ও দেনা হিসাব থাকবে।</span>
      </div>

      <div>
        {purchases.loading && purchases.rows.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : purchases.error ? (
          <ErrorState message={purchases.error} onRetry={() => void purchases.refetch()} />
        ) : purchases.rows.length === 0 ? (
          <EmptyState
            icon="box"
            title={t('purchase.empty')}
            action={
              can('manager')
                ? {
                    label: t('purchase.new'),
                    onClick: () => navigate('/purchases/new'),
                    icon: 'plus',
                  }
                : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-rule/60 card overflow-hidden">
            {purchases.rows.map((p) => (
              <li
                key={p.id}
                onClick={() => navigate(detailPath('purchase', p.id))}
                className="p-3.5 flex items-center justify-between hover:bg-canvas/50 cursor-pointer transition-colors gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-ink truncate">
                    {t('sell.invoiceNo', { no: num(p.invoice_no) })}
                  </p>
                  <p className="text-xs text-ink-faint truncate">
                    {date(p.purchased_at, { short: true })}
                    {p.supplier_ref ? ` • ${p.supplier_ref}` : ''}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="tnum font-bold text-sm text-ink">{money(p.total)}</p>
                  {p.due > 0 ? (
                    <Badge tone="warn">{t('khata.due')}: {money(p.due)}</Badge>
                  ) : (
                    <Badge tone="ok">{t('sell.paid')}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {can('manager') ? (
        <Fab
          name="plus"
          label={t('purchase.new')}
          onClick={() => navigate('/purchases/new')}
        />
      ) : null}
    </Screen>
  )
}
