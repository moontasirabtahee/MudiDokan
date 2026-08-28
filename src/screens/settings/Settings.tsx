import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Divider, Row } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import { updateShop } from '@/data/members'
import { useAction } from '@/hooks/useAction'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import { useAuth } from '@/providers/AuthProvider'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'

export default function Settings() {
  const { t } = useI18n()
  const { shop, shopId, can, role, reload } = useShop()
  const { user, displayName, signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [name, setName] = useState(() => shop?.name ?? '')
  const [nameBn, setNameBn] = useState(() => shop?.name_bn ?? '')
  const [receiptFooter, setReceiptFooter] = useState(() => shop?.receipt_footer ?? '')
  const [invoicePrefix, setInvoicePrefix] = useState(() => shop?.invoice_prefix ?? 'INV')

  const saveSettings = useAction(async () => {
    if (!shopId) return
    await updateShop(shopId, {
      name: name.trim() || shop?.name || 'মুদি দোকান',
      name_bn: nameBn.trim() || null,
      receipt_footer: receiptFooter.trim() || null,
      invoice_prefix: invoicePrefix.trim() || 'INV',
    })
    toast.say('common.saved')
    void reload()
  })

  return (
    <Screen title={t('settings.title')} back={() => navigate(ROUTES.home)}>
      {/* Active User Card */}
      <div className="card p-3.5 mb-3 bg-surface border border-rule flex items-center justify-between">
        <div>
          <p className="font-bold text-sm text-ink">{displayName || user?.email}</p>
          <p className="text-xs text-ink-soft">{user?.email}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-soft text-brand-deep">
          {role === 'owner' ? '👑 মালিক' : role === 'manager' ? '👔 ম্যানেজার' : '💼 ক্যাশিয়ার'}
        </span>
      </div>

      {/* Shop Info Card */}
      <div className="card p-4 space-y-3 mb-3">
        <h3 className="font-semibold text-sm text-ink">{t('settings.shop')}</h3>

        <Field label={t('onboard.shopName')}>
          {({ id: nameId, describedBy, invalid }) => (
            <Input
              id={nameId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!can('owner')}
            />
          )}
        </Field>

        <Field label={t('onboard.shopNameBn')} optional>
          {({ id: nameBnId, describedBy, invalid }) => (
            <Input
              id={nameBnId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={nameBn}
              onChange={(e) => setNameBn(e.target.value)}
              disabled={!can('owner')}
            />
          )}
        </Field>

        <Field label={t('settings.invoicePrefix')}>
          {({ id: pfxId, describedBy, invalid }) => (
            <Input
              id={pfxId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={invoicePrefix}
              onChange={(e) => setInvoicePrefix(e.target.value)}
              disabled={!can('owner')}
            />
          )}
        </Field>

        <Field label={t('settings.receiptFooter')} optional>
          {({ id: ftrId, describedBy, invalid }) => (
            <Input
              id={ftrId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              disabled={!can('owner')}
            />
          )}
        </Field>

        {can('owner') ? (
          <Button
            block
            variant="primary"
            loading={saveSettings.busy}
            onClick={() => void saveSettings.run()}
          >
            {t('common.save')}
          </Button>
        ) : null}
      </div>

      {/* Navigation list */}
      <div className="card p-3 space-y-2 mb-3">
        <Row
          title={t('settings.language')}
          trailing={<LocaleToggle />}
        />
        <Divider />
        <Row
          title={t('settings.staff')}
          onClick={() => navigate(ROUTES.staff)}
          chevron
        />
        <Divider />
        <Row
          title={t('billing.title')}
          onClick={() => navigate(ROUTES.billing)}
          chevron
        />
      </div>

      {/* Sign Out */}
      <div className="mt-4">
        <Button
          block
          variant="warn"
          icon="close"
          onClick={async () => {
            await signOut()
            navigate(ROUTES.login)
          }}
        >
          {t('auth.signOut')}
        </Button>
      </div>
    </Screen>
  )
}
