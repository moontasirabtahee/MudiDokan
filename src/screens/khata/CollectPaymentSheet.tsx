import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge, Divider, Row } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { CASH_DENOMINATIONS, TENDER_OPTIONS } from '@/lib/constants'
import type { CustomerDue, PaymentMethod, PaymentResult } from '@/lib/database.types'
import { shareText } from '@/lib/share'
import { newId } from '@/lib/utils'
import { invalidateCacheKey, invalidateCachePrefix } from '@/offline/db'
import { sync } from '@/offline/sync'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import { remainingDueAfterPayment } from './khata-utils'
import { buildPaymentReceiptText, smsUrl, whatsappUrl } from './reminders'

interface PaymentReceiptState {
  customerName: string
  customerPhone?: string | null
  previousDue: number
  amountPaid: number
  remainingDue: number
  method: PaymentMethod
  paidAt: string
  note?: string | null
}

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
  const { t, money, locale, timeZone, dateTime } = useI18n()
  const { shopId, shopName } = useShop()
  const toast = useToast()

  const [amount, setAmount] = useState<number | null>(() => customer?.due_balance ?? null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [receiptData, setReceiptData] = useState<PaymentReceiptState | null>(null)
  const [sharing, setSharing] = useState(false)

  // Reset/sync state when customer changes or sheet opens
  useEffect(() => {
    if (customer && open) {
      setAmount(customer.due_balance > 0 ? customer.due_balance : null)
      setMethod('cash')
      setNote('')
      setReceiptData(null)
    }
  }, [customer, open])

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

  function handleClose() {
    setReceiptData(null)
    onClose()
  }

  async function handleCollect() {
    if (!customer || !shopId || !isValid) return

    const now = new Date().toISOString()
    const paid = paymentAmount
    const prev = currentDue
    const rem = Math.max(0, remaining)
    const currentMethod = method
    const currentNote = note.trim() || null

    const outcome = await collect.write({
      args: {
        payload: {
          shop_id: shopId,
          client_uuid: newId(),
          party: 'customer',
          direction: 'in',
          customer_id: customer.id,
          amount: paid,
          method: currentMethod,
          note: currentNote,
          paid_at: now,
        },
      },
      amount: paid,
      label: `${t('khata.collectFrom', { name: customer.name })}`,
    })

    if (outcome.ok) {
      await invalidateCachePrefix(shopId, 'party:')
      await invalidateCacheKey(shopId, 'dashboard:today')
      sync.notifyMutation()
      void sync.refresh()
      onCollected?.()

      // Show receipt view
      setReceiptData({
        customerName: customer.name,
        customerPhone: customer.phone,
        previousDue: prev,
        amountPaid: paid,
        remainingDue: rem,
        method: currentMethod,
        paidAt: now,
        note: currentNote,
      })
    }
  }

  if (!customer) return null

  // ── RECEIPT / CONFIRMATION VIEW ──────────────────────────────────────────
  if (receiptData) {
    const data = receiptData
    const isFullyPaid = data.remainingDue <= 0
    const receiptBody = buildPaymentReceiptText({
      shopName: shopName || 'মুদি দোকান',
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      previousDue: data.previousDue,
      amountPaid: data.amountPaid,
      remainingDue: data.remainingDue,
      method: data.method,
      paidAt: data.paidAt,
      note: data.note,
      locale,
      timeZone,
    })

    const waLink = whatsappUrl(data.customerPhone, receiptBody)
    const smsLink = smsUrl(data.customerPhone, receiptBody)

    async function handleShare() {
      setSharing(true)
      try {
        const res = await shareText(receiptBody, `${data.customerName} — বাকি জমা রশিদ`)
        if (res === 'copied') toast.say('common.copied')
      } finally {
        setSharing(false)
      }
    }

    function handlePrint() {
      window.print()
    }

    return (
      <Sheet
        open={open}
        onClose={handleClose}
        title={locale === 'bn' ? 'টাকা জমা সফল হয়েছে' : 'Payment Successful'}
        footer={
          <div className="flex flex-col gap-2.5 w-full">
            <div className="flex gap-2">
              {waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary flex-1 flex items-center justify-center gap-1.5 h-11 text-xs font-semibold bg-[#25D366]/10 text-[#128C7E] border-[#25D366]/30 hover:bg-[#25D366]/20"
                >
                  <span>💬</span>
                  <span>{locale === 'bn' ? 'হোয়াটসঅ্যাপ' : 'WhatsApp'}</span>
                </a>
              ) : null}
              {smsLink ? (
                <a
                  href={smsLink}
                  className="btn btn-secondary flex-1 flex items-center justify-center gap-1.5 h-11 text-xs font-semibold border-rule"
                >
                  <span>✉️</span>
                  <span>{locale === 'bn' ? 'মেসেজ' : 'SMS'}</span>
                </a>
              ) : null}
              <Button
                variant="secondary"
                size="md"
                className="flex-1"
                icon="share"
                loading={sharing}
                onClick={() => void handleShare()}
              >
                {locale === 'bn' ? 'শেয়ার' : 'Share'}
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={handlePrint}
                title={locale === 'bn' ? 'প্রিন্ট করুন' : 'Print'}
              >
                🖨️
              </Button>
            </div>

            <Button
              size="lg"
              variant="primary"
              block
              icon="check"
              onClick={handleClose}
            >
              {t('common.done')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          {/* Success Banner */}
          <div className="flex flex-col items-center justify-center text-center p-4 rounded-card bg-ok-soft/50 border border-ok/30">
            <div className="w-12 h-12 rounded-full bg-ok text-white flex items-center justify-center text-2xl font-bold mb-2 shadow-sm">
              ✓
            </div>
            <h3 className="text-lg font-bold text-ink">
              {locale === 'bn' ? 'টাকা সফলভাবে জমা হয়েছে' : 'Payment Collected Successfully'}
            </h3>
            <p className="text-xs text-ink-soft mt-0.5">
              {dateTime(receiptData.paidAt)}
            </p>
          </div>

          {/* Customer & Status Header */}
          <div className="card p-3 space-y-2 bg-canvas/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-ink">{receiptData.customerName}</p>
                {receiptData.customerPhone ? (
                  <p className="text-xs text-ink-soft font-mono">{receiptData.customerPhone}</p>
                ) : null}
              </div>
              {isFullyPaid ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-ok-soft text-ok border border-ok/30">
                  <span>✅</span>
                  <span>{locale === 'bn' ? 'সম্পূর্ণ পরিশোধ' : 'Fully Paid'}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-warn-soft text-warn border border-warn/30">
                  <span>⚠️</span>
                  <span>{locale === 'bn' ? 'বাকি আছে' : 'Remaining Due'}</span>
                </span>
              )}
            </div>
          </div>

          {/* Amount Breakdown Card */}
          <div className="card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">{locale === 'bn' ? 'পূর্বের বাকি' : 'Previous Due'}</span>
              <span className="text-ink font-semibold">{money(receiptData.previousDue)}</span>
            </div>

            <div className="flex items-center justify-between text-base py-1 border-y border-rule">
              <span className="font-bold text-ink">{locale === 'bn' ? 'জমা নেওয়া হয়েছে' : 'Amount Paid'}</span>
              <span className="text-xl font-bold text-ok">{money(receiptData.amountPaid)}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">{locale === 'bn' ? 'অবশিষ্ট বাকি' : 'Remaining Due'}</span>
              <span className={`font-bold text-base ${isFullyPaid ? 'text-ok' : 'text-warn'}`}>
                {isFullyPaid ? (locale === 'bn' ? '৳০ (পরিশোধ)' : '৳0 (Clear)') : money(receiptData.remainingDue)}
              </span>
            </div>
          </div>

          {/* Payment Method & Meta */}
          <div className="rounded-card bg-canvas p-3 text-xs space-y-1 text-ink-soft">
            <div className="flex justify-between">
              <span>{locale === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Method'}:</span>
              <span className="font-semibold text-ink">
                {receiptData.method === 'bkash'
                  ? 'বিকাশ (bKash)'
                  : receiptData.method === 'nagad'
                    ? 'নগদ ডিজিটাল (Nagad)'
                    : receiptData.method === 'card'
                      ? 'কার্ড (Card)'
                      : 'নগদ টাকা (Cash)'}
              </span>
            </div>
            {receiptData.note ? (
              <div className="flex justify-between pt-1 border-t border-rule/50">
                <span>{locale === 'bn' ? 'মন্তব্য' : 'Note'}:</span>
                <span className="text-ink font-medium">{receiptData.note}</span>
              </div>
            ) : null}
          </div>
        </div>
      </Sheet>
    )
  }

  // ── COLLECTION FORM VIEW ────────────────────────────────────────────────
  return (
    <Sheet
      open={open}
      onClose={handleClose}
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
