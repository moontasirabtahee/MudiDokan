import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge, Row } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { CASH_DENOMINATIONS, TENDER_OPTIONS } from '@/lib/constants'
import type { PaymentMethod, PaymentResult, SupplierDue } from '@/lib/database.types'
import { newId } from '@/lib/utils'
import { invalidateCacheKey, invalidateCachePrefix } from '@/offline/db'
import { useShop } from '@/providers/ShopProvider'

export function PaySupplierSheet({
  open,
  onClose,
  supplier,
  onPaid,
}: {
  open: boolean
  onClose: () => void
  supplier: SupplierDue | null
  onPaid?: () => void
}) {
  const { t, money } = useI18n()
  const { shopId } = useShop()

  const [amount, setAmount] = useState<number | null>(() => supplier?.due_balance ?? null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')

  const pay = useWrite<'record_payment', PaymentResult>('record_payment', {
    success: 'supplier.paid',
  })

  const currentDue = supplier?.due_balance ?? 0
  const paymentAmount = amount ?? 0
  const remaining = currentDue - paymentAmount
  const isValid = paymentAmount > 0

  async function handlePay() {
    if (!supplier || !shopId || !isValid) return

    const outcome = await pay.write({
      args: {
        payload: {
          shop_id: shopId,
          client_uuid: newId(),
          party: 'supplier',
          direction: 'out',
          supplier_id: supplier.id,
          amount: paymentAmount,
          method,
          note: note.trim() || null,
          paid_at: new Date().toISOString(),
        },
      },
      amount: paymentAmount,
      label: `${t('supplier.pay')} — ${supplier.name}`,
    })

    if (outcome.ok) {
      void invalidateCacheKey(shopId, 'party:suppliers')
      void invalidateCacheKey(shopId, `party:${supplier.id}`)
      void invalidateCacheKey(shopId, `party:ledger:${supplier.id}`)
      void invalidateCacheKey(shopId, 'dashboard:today')
      void invalidateCachePrefix(shopId, 'party:')
      void invalidateCachePrefix(shopId, 'reports:')
      onPaid?.()
      onClose()
    }
  }

  if (!supplier) return null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('supplier.pay')}
      footer={
        <Button
          block
          size="lg"
          variant="primary"
          icon="check"
          loading={pay.busy}
          disabled={!isValid}
          onClick={() => void handlePay()}
        >
          {t('supplier.pay')}
        </Button>
      }
    >
      <p className="text-ink-soft text-sm mb-3">
        {supplier.name} {supplier.company ? `(${supplier.company})` : ''}
      </p>

      <div className="card mb-4 p-3 bg-brand-soft/30 border-brand-soft">
        <div className="flex items-baseline justify-between">
          <span className="text-ink-soft text-sm">{t('supplier.payable')}</span>
          <span className="text-ink text-xl font-bold">{money(currentDue)}</span>
        </div>
      </div>

      <Field label={t('common.amount')} required>
        {({ id: amountId, describedBy, invalid }) => (
          <AmountField
            id={amountId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={amount}
            onChange={setAmount}
            autoFocus
          />
        )}
      </Field>

      {/* Shortcuts */}
      <div className="mt-3 flex flex-wrap gap-2">
        {currentDue > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAmount(currentDue)}
          >
            {t('khata.collectFull')} ({money(currentDue)})
          </Button>
        ) : null}
        {CASH_DENOMINATIONS.slice(4).map((denom) => (
          <Button
            key={denom}
            size="sm"
            variant="ghost"
            onClick={() => setAmount(denom)}
          >
            {money(denom)}
          </Button>
        ))}
      </div>

      <div className="mt-4 rounded-field bg-canvas p-3">
        <Row
          title={t('supplier.payable')}
          trailing={
            remaining <= 0 ? (
              <Badge tone="ok">{t('khata.clear')}</Badge>
            ) : (
              <Badge tone="warn">{money(remaining)}</Badge>
            )
          }
        />
      </div>

      <div className="mt-4">
        <Field label={t('sell.method')}>
          {() => (
            <div className="grid grid-cols-2 gap-2">
              {TENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMethod(opt.value)}
                  className={`flex items-center justify-center gap-2 rounded-field border p-3 text-sm font-semibold transition-all ${
                    method === opt.value
                      ? 'border-brand bg-brand-soft text-brand-deep shadow-sm'
                      : 'border-rule bg-surface text-ink hover:bg-canvas'
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.bn}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
      </div>

      <Field label={t('common.note')} optional className="mt-3">
        {({ id: noteId, describedBy, invalid }) => (
          <Input
            id={noteId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('common.note')}
          />
        )}
      </Field>
    </Sheet>
  )
}
