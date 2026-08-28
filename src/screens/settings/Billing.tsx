import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/Feedback'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import { useShop } from '@/providers/ShopProvider'

export default function Billing() {
  const { t, num } = useI18n()
  const { plan, trialDaysLeft } = useShop()
  const navigate = useNavigate()

  const isTrial = plan === 'trial'
  const daysLeft = trialDaysLeft

  return (
    <Screen title={t('billing.title')} back={() => navigate(ROUTES.settings)}>
      <div className="card p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-ink-soft">{t('billing.plan')}</span>
          <Badge tone={isTrial ? 'warn' : 'ok'}>
            {isTrial ? t('billing.trial') : t('billing.active')}
          </Badge>
        </div>

        {isTrial ? (
          <div className="mt-2">
            <p className="font-bold text-lg text-ink">
              {daysLeft > 0 ? t('billing.trialLeft', { days: num(daysLeft) }) : t('billing.trialEnded')}
            </p>
            <p className="text-xs text-ink-soft mt-1">
              {t('billing.dataSafe')}
            </p>
          </div>
        ) : null}
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-sm text-ink">{t('billing.renew')}</h3>
        <p className="text-xs text-ink-soft">
          {t('billing.contact')}: 01700000000
        </p>
      </div>
    </Screen>
  )
}
