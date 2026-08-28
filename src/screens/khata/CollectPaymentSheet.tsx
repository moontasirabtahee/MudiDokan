import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge, Divider, Row } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { CASH_DENOMINATIONS, TENDER_OPTIONS } from '@/lib/constants'
import type { CustomerDue, PaymentMethod, PaymentResult } from '@/lib/database.types'
import { newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { remainingDueAfterPayment } from './khata-utils'

export function CollectPaymentSheet({
  open,
  onClose,
  customer,
  onCollected,
}: {
  open: boolean
  onClose: () => void
  customer: CustomerDue | null
  onCollected?: () => void
}) {
  const { t, money } = useI18n()
  const { shopId } = useShop()

  const [amount, setAmount] = useState<number | null>(() => customer?.due_balance ?? null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')

  const collect = useWrite<'record_payment', PaymentResult>('record_payment', {
    success: 'khata.collected',
  })

  const currentDue = customer?.due_balance ?? 0
  const paymentAmount = amount ?? 0
  const remaining = useMemo(
    () => remainingDueAfterPayment(currentDue, paymentAmount),
    [currentDue, paymentAmount],
  )

  const isValid = paymentAmount > 0

  async function handleCollect() {
    if (!customer || !shopId || !isValid) return

    const outcome = await collect.write({
      args: {
        payload: {
          shop_id: shopId,
          client_uuid: newId(),
          party: 'customer',
          direction: 'in',
          customer_id: customer.id,
          amount: paymentAmount,
          method,
          note: note.trim() || null,
          paid_at: new Date().toISOString(),
        },
      },
      amount: paymentAmount,
      label: `${t('khata.collectFrom', { name: customer.name })}`,
    })

    if (outcome.ok) {
      onCollected?.()
      onClose()
    }
  }

  if (!customer) return null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('khata.collectFrom', { name: customer.name })}
      footer={
        <Button
          block
          size="lg"
          variant="primary"
          icon="check"
          loading={collect.busy}
          disabled={!isValid}
          onClick={() => void handleCollect()}
        >
          {t('khata.collect')}
        </Button>
      }
    >
      <div className="card mb-4 p-3 bg-brand-soft/30 border-brand-soft">
        <div className="flex items-baseline justify-between">
          <span className="text-ink-soft text-sm">{t('khata.due')}</span>
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

      {/* Quick Amount Shortcuts */}
      <div className="mt-3 flex flex-wrap gap-2">
        {currentDue > 0 ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAmount(currentDue)}
            >
              {t('khata.collectFull')} ({money(currentDue)})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAmount(Math.round(currentDue / 2))}
            >
              {money(Math.round(currentDue / 2))}
            </Button>
          </>
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

      {/* Remaining Due Preview */}
      <div className="mt-4 rounded-field bg-canvas p-3">
        <Row
          title={t('sell.dueAfter', { amount: money(Math.max(0, remaining)) })}
          trailing={
            remaining <= 0 ? (
              <Badge tone="ok">{t('khata.clear')}</Badge>
            ) : (
              <Badge tone="warn">{money(remaining)}</Badge>
            )
          }
        />
      </div>

      <div className="my-4">
        <Divider />
      </div>

      {/* Payment Method */}
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
