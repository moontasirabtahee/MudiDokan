import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Divider, EmptyState, Row, SkeletonRows } from '@/components/ui/Feedback'
import { listSalesByMember } from '@/data/transactions'
import { listMembers } from '@/data/members'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'

export default function StaffSales() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { t, money, num, when } = useI18n()
  const { can } = useShop()

  const membersQuery = useQueryList('shop:members', (id) => listMembers(id), {
    staleMs: 60_000,
  })

  const member = useMemo(
    () => membersQuery.rows.find((m) => m.user_id === userId),
    [membersQuery.rows, userId],
  )

  const memberName = member?.profile?.full_name || member?.invited_email || userId || '—'

  const salesQuery = useQueryList(
    userId ? `staff:sales:${userId}` : null,
    (sid) => listSalesByMember(sid, userId!),
    { staleMs: 30_000, onSync: false, enabled: Boolean(userId) },
  )

  const stats = useMemo(() => {
    const completedSales = salesQuery.rows.filter((s) => s.status !== 'void')
    return {
      count: completedSales.length,
      total: completedSales.reduce((sum, s) => sum + s.total, 0),
      due: completedSales.reduce((sum, s) => sum + s.due, 0),
    }
  }, [salesQuery.rows])

  if (!can('manager')) return null

  return (
    <Screen
      title={t('settings.staffSales', { name: memberName })}
      back={() => navigate(ROUTES.staff)}
    >
      <div className="card p-4 mb-3">
        <p className="text-ink-soft text-xs mb-3">{t('settings.staffSalesHelp')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('settings.staffSalesTotal')} value={money(stats.total)} tone="brand" />
          <Stat label={t('settings.staffSalesCount')} value={num(stats.count)} tone="neutral" />
        </div>
        {stats.due > 0 ? (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-ink-soft">{t('khata.due')}</span>
            <span className="tnum font-semibold text-warn">{money(stats.due)}</span>
          </div>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        {salesQuery.loading && salesQuery.rows.length === 0 ? (
          <SkeletonRows rows={5} />
        ) : salesQuery.rows.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={t('settings.staffSalesEmpty')}
            body={t('settings.staffSalesEmptyHelp')}
          />
        ) : (
          <ul className="divide-y divide-rule/60">
            {salesQuery.rows.map((sale, index) => (
              <div key={sale.id}>
                {index > 0 ? <Divider inset /> : null}
                <Row
                  title={
                    sale.invoice_no > 0
                      ? t('sell.invoiceNo', { no: num(sale.invoice_no) })
                      : t('settings.pending')
                  }
                  subtitle={when(sale.sold_at)}
                  trailing={
                    <span className="text-right shrink-0">
                      <span
                        className={cn(
                          'tnum font-semibold text-sm block',
                          sale.status === 'void' ? 'text-ink-faint line-through' : 'text-ink',
                        )}
                      >
                        {money(sale.total)}
                      </span>
                      {sale.status === 'void' ? (
                        <span className="text-xs text-danger">{t('sell.voided')}</span>
                      ) : sale.due > 0 ? (
                        <span className="text-xs text-warn">{t('khata.due')}: {money(sale.due)}</span>
                      ) : (
                        <span className="text-xs text-brand">{t('sell.paid')}</span>
                      )}
                    </span>
                  }
                />
              </div>
            ))}
          </ul>
        )}
      </div>

      {salesQuery.rows.length > 0 && (
        <p className="text-ink-faint text-xs text-center mt-4 px-2">
          {t('common.count')}: {num(salesQuery.rows.length)}
        </p>
      )}
    </Screen>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'brand' | 'warn'
}) {
  return (
    <div>
      <p className="text-ink-faint text-xs">{label}</p>
      <p
        className={cn(
          'tnum text-xl font-bold mt-0.5',
          tone === 'brand' ? 'text-brand' : tone === 'warn' ? 'text-warn' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  )
}
