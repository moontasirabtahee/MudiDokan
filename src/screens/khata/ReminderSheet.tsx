import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Divider } from '@/components/ui/Feedback'
import { TextArea } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { useI18n } from '@/i18n/I18nProvider'
import type { CustomerDue } from '@/lib/database.types'
import { copyToClipboard } from '@/lib/share'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import { buildReminderText, smsUrl, whatsappUrl } from './reminders'

export function ReminderSheet({
  open,
  onClose,
  customer,
}: {
  open: boolean
  onClose: () => void
  customer: CustomerDue | null
}) {
  const { t, locale } = useI18n()
  const { shopName } = useShop()
  const toast = useToast()

  const [tone, setTone] = useState<'polite' | 'firm'>('polite')
  const [includeBkash, setIncludeBkash] = useState(true)

  const defaultText = customer
    ? buildReminderText(
        {
          shopName: shopName || 'মুদি দোকান',
          customerName: customer.name,
          amount: customer.due_balance,
          dueDays: customer.days_since_payment,
          bkashNumber: includeBkash ? '01712345678' : null,
          tone,
        },
        locale,
      )
    : ''

  const [message, setMessage] = useState(defaultText)

  function updateTemplate(newTone: 'polite' | 'firm', withBkash: boolean) {
    setTone(newTone)
    setIncludeBkash(withBkash)
    if (customer) {
      setMessage(
        buildReminderText(
          {
            shopName: shopName || 'মুদি দোকান',
            customerName: customer.name,
            amount: customer.due_balance,
            dueDays: customer.days_since_payment,
            bkashNumber: withBkash ? '01712345678' : null,
            tone: newTone,
          },
          locale,
        ),
      )
    }
  }

  if (!customer) return null

  const waLink = whatsappUrl(customer.phone, message)
  const smsLink = smsUrl(customer.phone, message)

  async function handleCopy() {
    const ok = await copyToClipboard(message)
    if (ok) {
      toast.say('common.copied')
    } else {
      toast.say('error.generic', undefined, { kind: 'error' })
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('khata.remindTitle')}
      footer={
        <Button block variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-ink-soft text-sm font-medium">{customer.name} {customer.phone ? `(${customer.phone})` : ''}</p>
        <span className="text-xs text-brand font-semibold">বাকি: ৳{customer.due_balance}</span>
      </div>

      {/* Template Quick Selection */}
      <div className="flex items-center gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => updateTemplate('polite', includeBkash)}
          className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
            tone === 'polite'
              ? 'bg-brand text-white'
              : 'bg-surface border border-rule text-ink-soft hover:bg-canvas'
          }`}
        >
          🌸 ভদ্র তাগাদা
        </button>
        <button
          type="button"
          onClick={() => updateTemplate('firm', includeBkash)}
          className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
            tone === 'firm'
              ? 'bg-brand text-white'
              : 'bg-surface border border-rule text-ink-soft hover:bg-canvas'
          }`}
        >
          ⚡ জরুরি তাগাদা
        </button>
        <button
          type="button"
          onClick={() => updateTemplate(tone, !includeBkash)}
          className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ml-auto ${
            includeBkash
              ? 'bg-ok-soft text-ok font-semibold'
              : 'bg-surface border border-rule text-ink-faint'
          }`}
        >
          {includeBkash ? '✓ বিকাশ নম্বরসহ' : '+ বিকাশ নম্বর'}
        </button>
      </div>

      <TextArea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        className="text-sm font-sans"
      />

      <div className="my-4">
        <Divider />
      </div>

      <div className="flex flex-col gap-2">
        {waLink ? (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary flex items-center justify-center gap-2 h-12 w-full text-base font-semibold bg-[#25D366] hover:bg-[#20bd5a] text-white border-transparent"
          >
            <span>💬</span>
            <span>{t('khata.remindWhatsapp')}</span>
          </a>
        ) : null}

        {smsLink ? (
          <a
            href={smsLink}
            className="btn btn-outline flex items-center justify-center gap-2 h-12 w-full text-base font-semibold"
          >
            <span>✉️</span>
            <span>{t('khata.remindSms')}</span>
          </a>
        ) : null}

        <Button
          block
          variant="ghost"
          icon="check"
          onClick={() => void handleCopy()}
        >
          {t('common.copy')}
        </Button>
      </div>
    </Sheet>
  )
}
