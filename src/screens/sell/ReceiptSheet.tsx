import { Button } from '@/components/ui/Button'
import { Divider } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { Sheet } from '@/components/ui/Sheet'
import { useI18n } from '@/i18n/I18nProvider'
import { shareText } from '@/lib/share'
import { smsUrl, whatsappUrl } from '@/screens/khata/reminders'
import { type ReceiptData, invoiceLabel, receiptText } from './receipt'

/**
 * The sheet that closes a sale.
 *
 * What it puts at the top is the number the cashier needs *next*: change owed, if
 * any, at the largest size on screen. Not the total — the total was on the previous
 * screen and has already been agreed. The transaction is not over until the change
 * is in the customer's hand, and this is the moment people make mistakes.
 */
export function ReceiptSheet({
  open,
  data,
  queued,
  onClose,
  onNext,
}: {
  open: boolean
  data: ReceiptData | null
  /** The sale is on the phone, not the server. Changes the wording, not the receipt. */
  queued: boolean
  onClose: () => void
  onNext: () => void
}) {
  const { t, locale, money, qty, timeZone } = useI18n()

  if (!data) return null

  const receiptBody = receiptText(data, locale, timeZone)
  const waLink = whatsappUrl(null, receiptBody) || `https://api.whatsapp.com/send?text=${encodeURIComponent(receiptBody)}`
  const smsLink = smsUrl(null, receiptBody) || `sms:?body=${encodeURIComponent(receiptBody)}`

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('sell.done')}
      footer={
        <div className="flex flex-col gap-2 w-full">
          <div className="flex gap-2">
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary flex-1 flex items-center justify-center gap-1.5 h-11 text-xs font-semibold bg-[#25D366]/10 text-[#128C7E] border-[#25D366]/30 hover:bg-[#25D366]/20"
            >
              <span>💬</span>
              <span>হোয়াটসঅ্যাপে রসিদ</span>
            </a>
            <a
              href={smsLink}
              className="btn btn-secondary flex-1 flex items-center justify-center gap-1.5 h-11 text-xs font-semibold border-rule"
            >
              <span>✉️</span>
              <span>মেসেজে রসিদ</span>
            </a>
          </div>

          <div className="flex gap-3">
            <Button
              size="lg"
              variant="secondary"
              block
              icon="share"
              onClick={() => void shareText(receiptBody, data.shopName)}
            >
              {t('sell.shareReceipt')}
            </Button>
            <Button size="lg" variant="primary" block icon="plus" onClick={onNext}>
              {t('sell.newSale')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="pb-2">
        {/* Change first, and big. This is the number that is about to be counted out. */}
        {data.change > 0 ? (
          <div className="bg-ok-soft rounded-card px-4 py-3 text-center">
            <p className="text-ink-soft text-sm">{t('sell.change')}</p>
            <p className="tnum text-ok text-4xl font-bold">{money(data.change)}</p>
          </div>
        ) : (
          <div className="bg-brand-soft rounded-card px-4 py-3 text-center">
            <p className="text-ink-soft text-sm">{t('common.total')}</p>
            <p className="tnum text-brand-deep text-4xl font-bold">{money(data.total)}</p>
          </div>
        )}

        {data.due > 0 ? (
          <div className="bg-warn-soft mt-2 flex items-center gap-2 rounded-card px-3.5 py-2.5">
            <Icon name="book" size="sm" className="text-ink shrink-0" />
            <span className="text-ink text-sm">
              {t('sell.due')}: <span className="tnum font-semibold">{money(data.due)}</span>
              {data.customerName ? ` — ${data.customerName}` : ''}
            </span>
          </div>
        ) : null}

        <div className="text-ink-soft mt-3 flex items-center justify-between text-sm">
          <span>{invoiceLabel(data, locale)}</span>
          {queued ? (
            <span className="text-ink-faint inline-flex items-center gap-1">
              <Icon name="cloudOff" size="sm" />
              {t('sync.queued')}
            </span>
          ) : null}
        </div>

        <Divider />

        <ul className="space-y-1.5">
          {data.lines.map((line, index) => (
            <li key={index} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink min-w-0 flex-1 truncate">{line.name}</span>
              <span className="text-ink-faint tnum shrink-0 text-xs">
                {qty(line.qty, line.unit)} × {money(line.unitPrice)}
              </span>
              <span className="tnum text-ink w-20 shrink-0 text-end font-medium">
                {money(line.lineTotal)}
              </span>
            </li>
          ))}
        </ul>

        <Divider />

        <dl className="space-y-1 text-sm">
          {data.discount > 0 ? (
            <Line label={t('common.discount')} value={`−${money(data.discount)}`} />
          ) : null}
          <Line label={t('common.total')} value={money(data.total)} strong />
          <Line label={t('sell.paid')} value={money(data.paid)} />
        </dl>
      </div>
    </Sheet>
  )
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={strong ? 'text-ink font-medium' : 'text-ink-soft'}>{label}</dt>
      <dd className={strong ? 'tnum text-ink text-base font-semibold' : 'tnum text-ink'}>{value}</dd>
    </div>
  )
}
