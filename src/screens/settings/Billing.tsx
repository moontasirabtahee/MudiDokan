import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import { useShop } from '@/providers/ShopProvider'

export default function Billing() {
  const { t, num } = useI18n()
  const { plan, trialDaysLeft, canWrite } = useShop()
  const navigate = useNavigate()

  const isTrial = plan === 'trial'
  const daysLeft = trialDaysLeft

  return (
    <Screen title={t('billing.title')} back={() => navigate(ROUTES.settings)}>
      <div className="card p-4 mb-3 bg-gradient-to-br from-surface to-brand-soft/20 border border-rule shadow-card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-ink-soft">{t('billing.plan')}</span>
          <Badge tone={canWrite ? (isTrial ? 'warn' : 'ok') : 'danger'}>
            {isTrial ? t('billing.trial') : canWrite ? t('billing.active') : t('billing.readOnly')}
          </Badge>
        </div>

        {isTrial ? (
          <div className="mt-2">
            <p className="font-extrabold text-xl text-ink">
              {daysLeft > 0 ? t('billing.trialLeft', { days: num(daysLeft) }) : t('billing.trialEnded')}
            </p>
            <p className="text-xs text-ink-soft mt-1">
              {t('billing.dataSafe')}
            </p>
          </div>
        ) : (
          <div className="mt-2">
            <p className="font-extrabold text-xl text-brand">প্রিমিয়াম প্যাকেজ (চালু)</p>
            <p className="text-xs text-ink-soft mt-1">সবগুলো ফিচার আনলিমিটেড ব্যবহার করতে পারবেন</p>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Icon name="phone" size={16} />
          </span>
          <h3 className="font-semibold text-sm text-ink">{t('billing.renew')} ও সহায়তা</h3>
        </div>

        <p className="text-xs text-ink-soft">
          মেয়াদ বাড়াতে বা যে কোনো প্রয়োজনে সরাসরি আমাদের কাস্টমার সার্ভিসে যোগাযোগ করুন।
        </p>

        <div className="pt-2 grid grid-cols-2 gap-2">
          <a
            href="tel:+8801700000000"
            className="flex items-center justify-center gap-2 p-2.5 rounded-card bg-surface border border-rule text-ink text-xs font-bold hover:bg-brand-soft hover:text-brand transition-all shadow-2xs"
          >
            <Icon name="phone" size={14} className="text-brand" />
            <span>সরাসরি কল</span>
          </a>
          <a
            href="https://wa.me/8801700000000"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 p-2.5 rounded-card bg-[#25D366]/10 border border-[#25D366]/30 text-[#128C7E] text-xs font-bold hover:bg-[#25D366]/20 transition-all shadow-2xs"
          >
            <Icon name="share" size={14} className="text-[#25D366]" />
            <span>হোয়াটসঅ্যাপ</span>
          </a>
        </div>
      </div>
    </Screen>
  )
}
