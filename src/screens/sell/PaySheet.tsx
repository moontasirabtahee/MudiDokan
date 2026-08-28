import { type ReactNode, useMemo, useState } from 'react'
import { PartyPicker } from '@/components/PartyPicker'
import { Button } from '@/components/ui/Button'
import { Field, TextArea } from '@/components/ui/Field'
import { Badge, Divider, Row } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { AmountField } from '@/components/ui/NumberField'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { listCustomerDues } from '@/data/parties'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { TENDER_OPTIONS } from '@/lib/constants'
import type { PaymentMethod } from '@/lib/database.types'
import { roundTo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import {
  type CartAction,
  type CartState,
  type CartTotals,
  belowCostLines,
  cartProblems,
} from './cart'

/**
 * Taking the money.
 *
 * The whole sheet is arranged around one fact: nearly every sale is paid in full, in
 * cash, immediately. So the default state of this sheet is already correct — `paid`
 * is null, which means the total — and a cashier can open it and tap the green
 * button without touching anything else. Two taps for the common case.
 *
 * Everything else on the sheet is for the minority of sales, and is arranged in
 * descending order of how often it is needed: how much was handed over (change), who
 * owes the rest (credit), how it was tendered (wallet), and why (note).
 *
 * ## Warnings that do not block
 *
 * A due with nobody attached is refused, because an anonymous debt is not a debt and
 * the app would have nowhere to write it. Everything else is shown and permitted.
 * Going past a credit limit is the interesting case: the limit is the shopkeeper's own
 * note to himself about a customer, and a shopkeeper looking at a man he has known
 * for twenty years knows things about today that he did not know when he set it.
 * Warning is respectful; refusing is the app claiming to know his customers better
 * than he does.
 */
export function PaySheet({
  open,
  onClose,
  cart,
  totals,
  dispatch,
  onComplete,
  busy,
}: {
  open: boolean
  onClose: () => void
  cart: CartState
  totals: CartTotals
  dispatch: (action: CartAction) => void
  onComplete: () => void
  busy: boolean
}) {
  const { t, money, num, locale } = useI18n()
  const { can } = useShop()
  const [picking, setPicking] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)

  // Cache-first, so this works with the tower down. The picker reads the same key,
  // so opening it costs nothing.
  const customers = useQueryList(open ? 'party:customers' : null, listCustomerDues, {
    staleMs: 60_000,
  })
  const customer = useMemo(
    () => customers.rows.find((row) => row.id === cart.customerId) ?? null,
    [customers.rows, cart.customerId],
  )

  const problems = cartProblems(cart, totals)
  const blocked = problems.length > 0
  const needsCustomer = problems.includes('dueWithoutCustomer')

  const balanceAfter = customer ? roundTo(customer.due_balance + totals.due, 2) : null
  const overLimit =
    customer != null &&
    customer.credit_limit > 0 &&
    balanceAfter != null &&
    balanceAfter > customer.credit_limit

  const underCost = can('manager') ? belowCostLines(cart) : []

  const tenderOptions: SegmentedOption<PaymentMethod>[] = TENDER_OPTIONS.map((option) => ({
    value: option.value,
    label: locale === 'bn' ? option.bn : option.en,
  }))

  /** Handing over another note. Adds, because that is what the hand does. */
  function tender(amount: number) {
    dispatch({ type: 'paid', amount: roundTo((cart.paid ?? 0) + amount, 2) })
  }

  return (
    <>
      <Sheet
        open={open && !picking}
        onClose={onClose}
        title={t('sell.payable')}
        // No escape hatch mid-write: the button is already spinning and closing the
        // sheet would leave a cashier unsure whether the sale went through.
        dismissible={!busy}
        footer={
          <Button
            size="lg"
            block
            loading={busy}
            disabled={blocked}
            icon="check"
            onClick={onComplete}
          >
            {busy ? t('sell.completing') : t('sell.complete')}
          </Button>
        }
      >
        <div className="space-y-3 pb-2">
          {/* ── What is owed ─────────────────────────────────────────────── */}
          <div className="bg-brand-soft rounded-card px-4 py-3 text-center">
            <p className="text-ink-soft text-sm">{t('sell.payable')}</p>
            <p className="tnum text-brand-deep text-4xl font-bold">{money(totals.total)}</p>
            {totals.lineDiscounts + totals.discount > 0 ? (
              <p className="text-ink-faint text-xs">
                {t('common.discount')} {money(roundTo(totals.discount + totals.lineDiscounts, 2))}
              </p>
            ) : null}
          </div>

          {/* ── What was handed over ─────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex gap-2">
              <Button
                size="sm"
                variant={cart.paid === null || cart.paid === totals.total ? 'primary' : 'secondary'}
                className="flex-1 font-semibold"
                onClick={() => dispatch({ type: 'paid', amount: totals.total })}
              >
                {t('sell.fullPaid')} ({money(totals.total)})
              </Button>
              <Button
                size="sm"
                variant={cart.paid === 0 ? 'warn' : 'secondary'}
                className="flex-1 font-semibold"
                onClick={() => dispatch({ type: 'paid', amount: 0 })}
              >
                {t('sell.due')} (৳০)
              </Button>
            </div>

            <AmountField
              value={cart.paid}
              onChange={(next) => dispatch({ type: 'paid', amount: next })}
              placeholder={num(totals.total, { decimals: 'auto' })}
              aria-label={t('sell.paid')}
              emphasis
            />

            {/* Smart Next Note Shortcuts (e.g. ৳50, ৳100, ৳500, ৳1000) */}
            <div className="mt-2.5">
              <span className="text-xs text-ink-faint font-medium mb-1.5 block">নোটের বোতাম (টাকা হাতে নিলে চাপুন):</span>
              <div className="grid grid-cols-4 gap-1.5">
                {[50, 100, 500, 1000].map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => dispatch({ type: 'paid', amount: note })}
                    className={cn(
                      'tnum h-10 rounded-card border text-sm font-semibold transition-all',
                      cart.paid === note
                        ? 'bg-brand text-white border-brand shadow-sm'
                        : 'bg-paper text-ink border-rule hover:bg-canvas active:bg-brand-soft',
                    )}
                  >
                    ৳{note}
                  </button>
                ))}
              </div>
            </div>

            {/* Incremental Cash Additions */}
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {[10, 20, 100, 200].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => tender(value)}
                  className="bg-canvas/60 text-ink-soft border-rule tnum h-8 rounded-card border text-xs font-medium active:bg-brand-soft"
                >
                  +{money(value)}
                </button>
              ))}
            </div>
          </div>

          {/* Prominent Change / Due Box */}
          {totals.change > 0 ? (
            <div className="bg-ok-soft border-2 border-ok/30 flex flex-col items-center justify-center rounded-xl p-3.5 shadow-sm animate-fade-in">
              <span className="text-ok font-semibold text-sm">গ্রাহককে ফেরত দিন (Change Due)</span>
              <span className="tnum text-ok text-3xl font-extrabold tracking-tight mt-0.5">{money(totals.change)}</span>
            </div>
          ) : null}
          {totals.due > 0 ? (
            <div className="bg-warn-soft border border-warn/30 flex items-baseline justify-between rounded-xl px-3.5 py-2.5">
              <span className="text-ink text-sm font-medium">{t('sell.due')} (বাকি থাকবে)</span>
              <span className="tnum text-ink text-2xl font-bold">{money(totals.due)}</span>
            </div>
          ) : null}

          {/* ── Who owes it ──────────────────────────────────────────────── */}
          <Divider />
          <Row
            onClick={() => setPicking(true)}
            leading={
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-pill',
                  needsCustomer ? 'bg-danger-soft text-danger' : 'bg-paper text-ink-soft',
                )}
              >
                <Icon name="user" size="sm" />
              </span>
            }
            title={customer ? customer.name : t('sell.walkIn')}
            subtitle={
              needsCustomer
                ? t('sell.creditWarning')
                : balanceAfter != null && balanceAfter > 0
                  ? t('sell.dueAfter', { amount: money(balanceAfter) })
                  : customer?.phone
                    ? undefined
                    : t('sell.chooseCustomer')
            }
            trailing={
              overLimit ? <Badge tone="warn" icon="alert">{t('khata.overLimit')}</Badge> : undefined
            }
            chevron
          />

          {/* ── Advisories ───────────────────────────────────────────────── */}
          {overLimit && customer ? (
            <Advisory tone="warn" icon="alert">
              {t('sell.overLimit')} — {t('khata.creditLimit')} {money(customer.credit_limit)}
            </Advisory>
          ) : null}
          {underCost.length > 0 ? (
            <Advisory tone="warn" icon="tag">
              {t('product.priceBelowCost')}: {underCost.map((line) => line.name).join(', ')}
            </Advisory>
          ) : null}
          {totals.costPartial && can('manager') ? (
            <Advisory tone="neutral" icon="info">
              {t('report.profitPartial')}
            </Advisory>
          ) : null}

          {/* ── How it was tendered ──────────────────────────────────────── */}
          {totals.paid > 0 ? (
            <div>
              <p className="text-ink-soft mb-1.5 text-sm">{t('sell.method')}</p>
              <Segmented
                value={cart.method}
                onChange={(method) => dispatch({ type: 'method', method })}
                options={tenderOptions}
                label={t('sell.method')}
                size="sm"
              />

              {(cart.method === 'bkash' || cart.method === 'nagad' || cart.method === 'rocket') && (
                <div className="mt-2 bg-brand-soft border border-brand/25 text-xs text-brand-deep p-2.5 rounded-card flex items-center gap-2">
                  <span className="text-base">📱</span>
                  <span>গ্রাহক মোবাইল ব্যাংকিংয়ে টাকা পাঠালে কনফার্মেশন দেখে "বিক্রি শেষ করুন" চাপুন।</span>
                </div>
              )}
            </div>
          ) : null}

          {/* ── Why ──────────────────────────────────────────────────────── */}
          {noteOpen || cart.note ? (
            <Field label={t('common.note')} optional>
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={2}
                  value={cart.note}
                  onChange={(event) => dispatch({ type: 'note', text: event.target.value })}
                />
              )}
            </Field>
          ) : (
            <Button variant="ghost" size="sm" icon="pencil" onClick={() => setNoteOpen(true)}>
              {t('common.note')}
            </Button>
          )}
        </div>
      </Sheet>

      <PartyPicker
        open={picking}
        onClose={() => setPicking(false)}
        party="customer"
        anonymousLabel={t('sell.walkIn')}
        onPick={(id) => dispatch({ type: 'customer', customerId: id })}
      />
    </>
  )
}

function Advisory({
  tone,
  icon,
  children,
}: {
  tone: 'warn' | 'neutral'
  icon: 'alert' | 'tag' | 'info'
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-card px-3 py-2 text-sm',
        tone === 'warn' ? 'bg-warn-soft text-ink' : 'bg-paper text-ink-soft',
      )}
    >
      <Icon name={icon} size="sm" className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}
