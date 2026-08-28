import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, IconButton } from '@/components/ui/Button'
import { Badge, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import { useConfirm } from '@/components/ui/Sheet'
import { getCustomerDue, listPartyLedger } from '@/data/parties'
import { listSalesForCustomer } from '@/data/transactions'
import { useQuery, useQueryList } from '@/hooks/useQuery'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES } from '@/lib/constants'
import type { CustomerDue, PartyLedgerEntry } from '@/lib/database.types'
import { shareText } from '@/lib/share'
import { cn, newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import { CollectPaymentSheet } from './CollectPaymentSheet'
import { CustomerSheet } from './CustomerSheet'
import { OpeningBalanceSheet } from './OpeningBalanceSheet'
import { ReminderSheet } from './ReminderSheet'
import { agingCategory, agingTone, isOverLimit } from './khata-utils'
import { buildReminderText, smsUrl, statementText, whatsappUrl } from './reminders'

type DetailTab = 'ledger' | 'sales'

export default function PartyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, locale, timeZone, money, num, date, when } = useI18n()
  const { shopName, can, shopId } = useShop()
  const toast = useToast()
  const [confirm, confirmElement] = useConfirm()

  const [tab, setTab] = useState<DetailTab>('ledger')
  const [collectOpen, setCollectOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [openingBalOpen, setOpeningBalOpen] = useState(false)
  const [sharing, setSharing] = useState(false)

  const customerQuery = useQuery<CustomerDue>(
    id ? `party:${id}` : null,
    () => getCustomerDue(id!),
    { staleMs: 5_000, onSync: true },
  )

  const ledgerQuery = useQueryList<PartyLedgerEntry>(
    id ? `party:ledger:${id}` : null,
    () => listPartyLedger('customer', id!),
    { staleMs: 5_000, onSync: true },
  )

  const salesQuery = useQueryList(
    id ? `party:sales:${id}` : null,
    () => listSalesForCustomer(id!, 20),
    { staleMs: 5_000, onSync: true },
  )

  const writeOff = useWrite('set_opening_balance')

  const customer = customerQuery.data

  const tone = useMemo(
    () => agingTone(customer?.days_since_payment),
    [customer?.days_since_payment],
  )

  async function handleShareStatement() {
    if (!customer || sharing) return
    setSharing(true)
    try {
      const text = statementText({
        shopName: shopName || 'মুদি দোকান',
        customer,
        entries: ledgerQuery.rows,
        locale,
        timeZone,
      })
      const res = await shareText(text, `${customer.name} — ${t('khata.title')}`)
      if (res === 'copied') toast.say('common.copied')
    } finally {
      setSharing(false)
    }
  }

  async function handleWriteOff() {
    if (!customer || !shopId || customer.due_balance <= 0) return
    const ok = await confirm({
      title: t('khata.writeOff'),
      body: t('khata.writeOffWarning'),
      confirmLabel: t('khata.writeOff'),
      danger: true,
    })
    if (!ok) return

    const outcome = await writeOff.write({
      args: {
        payload: {
          shop_id: shopId,
          client_uuid: newId(),
          party: 'customer',
          customer_id: customer.id,
          amount: -customer.due_balance,
          entry_type: 'write_off',
          note: null,
          occurred_at: new Date().toISOString(),
        },
      },
      amount: customer.due_balance,
      label: `${t('khata.writeOff')} — ${customer.name}`,
    })

    if (outcome.ok) {
      void customerQuery.refetch()
      void ledgerQuery.refetch()
    }
  }

  if (customerQuery.loading && !customer) {
    return (
      <Screen title={t('khata.title')} back={() => navigate(ROUTES.khata)}>
        <SkeletonRows rows={4} />
      </Screen>
    )
  }

  if (!customer) {
    return (
      <Screen title={t('khata.title')} back={() => navigate(ROUTES.khata)}>
        <ErrorState message={customerQuery.error ?? t('error.notFound')} />
      </Screen>
    )
  }

  const creditLimit = customer.credit_limit
  const due = customer.due_balance
  const percentUsed = creditLimit > 0 ? Math.min(100, Math.round((due / creditLimit) * 100)) : 0

  const tabs: SegmentedOption<DetailTab>[] = [
    { value: 'ledger', label: t('khata.history') },
    { value: 'sales', label: t('sell.title') },
  ]

  return (
    <Screen
      title={customer.name}
      back={() => navigate(ROUTES.khata)}
      actions={
        <>
          <IconButton
            name="share"
            label={t('common.share')}
            variant="ghost"
            onClick={() => void handleShareStatement()}
          />
          <IconButton
            name="settings"
            label={t('common.edit')}
            variant="ghost"
            onClick={() => setEditOpen(true)}
          />
        </>
      }
      footer={
        due > 0 ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="primary"
              size="lg"
              onClick={() => setCollectOpen(true)}
            >
              {t('khata.collect')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setReminderOpen(true)}
              disabled={!customer.phone}
            >
              {t('khata.remindTitle')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {/* ── Balance Hero Card ─────────────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-ink-faint font-medium">{t('khata.totalDue')}</p>
            <p
              className={cn(
                'text-3xl font-extrabold tnum mt-0.5',
                due > 0 ? 'text-warn' : 'text-brand',
              )}
            >
              {money(due)}
            </p>
          </div>

          {customer.phone ? (
            <div className="flex items-center gap-1.5">
              <a
                href={`tel:${customer.phone}`}
                title="কল করুন"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-pill bg-brand-soft text-brand text-xs font-semibold hover:bg-brand/20 transition-all"
              >
                <Icon name="phone" size={13} />
                <span>কল</span>
              </a>
              {due > 0 && (
                <>
                  <a
                    href={
                      whatsappUrl(
                        customer.phone,
                        buildReminderText({
                          shopName: shopName || 'দোকান',
                          customerName: customer.name,
                          amount: due,
                        }),
                      ) ?? '#'
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    title="হোয়াটসঅ্যাপে তাগাদা"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-pill bg-[#25D366]/15 text-[#128C7E] text-xs font-semibold hover:bg-[#25D366]/25 transition-all"
                  >
                    <Icon name="whatsapp" size={13} />
                    <span>হোয়াটসঅ্যাপ</span>
                  </a>
                  <a
                    href={
                      smsUrl(
                        customer.phone,
                        buildReminderText({
                          shopName: shopName || 'দোকান',
                          customerName: customer.name,
                          amount: due,
                        }),
                      ) ?? '#'
                    }
                    title="মেসেজে তাগাদা"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-pill bg-canvas border border-rule text-ink-soft text-xs font-semibold hover:bg-brand-soft hover:text-brand transition-all"
                  >
                    <span>✉️</span>
                    <span>এসএমএস</span>
                  </a>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Credit Limit Usage Bar */}
        {creditLimit > 0 ? (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-xs text-ink-soft">
              <span>{t('khata.creditLimit')}</span>
              <span className="tnum">
                {money(due)} / {money(creditLimit)} ({num(percentUsed)}%)
              </span>
            </div>
            <div className="h-2 rounded-full bg-rule overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-300',
                  percentUsed >= 100
                    ? 'bg-danger'
                    : percentUsed >= 80
                      ? 'bg-warn'
                      : 'bg-brand',
                )}
                style={{ width: `${Math.min(100, percentUsed)}%` }}
              />
            </div>
            {isOverLimit(due, creditLimit) ? (
              <p className="text-xs text-danger font-medium flex items-center gap-1">
                <Icon name="alert" size={12} />
                <span>{t('khata.overLimit')}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Debt Aging Status */}
        {due > 0 && customer.days_since_payment != null ? (
          <div className="flex items-center gap-2 pt-1">
            <Badge tone={tone}>
              {t(`khata.aging.${agingCategory(customer.days_since_payment)}` as 'khata.aging.current')} (
              {t('khata.sinceDays', { days: num(customer.days_since_payment) })})
            </Badge>
          </div>
        ) : null}

        {customer.address ? (
          <p className="text-xs text-ink-faint flex items-center gap-1 pt-1">
            <Icon name="home" size={12} />
            <span>{customer.address}</span>
          </p>
        ) : null}
      </div>

      {/* ── Quick Action Buttons ──────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpeningBalOpen(true)}
        >
          {t('khata.openingBalance')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setReminderOpen(true)}
          disabled={!customer.phone || due <= 0}
        >
          {t('khata.remindTitle')}
        </Button>
        {can('manager') && due > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleWriteOff()}
          >
            {t('khata.writeOff')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
          >
            {t('common.edit')}
          </Button>
        )}
      </div>

      {/* ── Tabs & History ────────────────────────────────────────────────── */}
      <div className="mt-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={tabs}
          label={t('common.actions')}
          size="sm"
        />
      </div>

      <div className="mt-3">
        {tab === 'ledger' ? (
          <div className="card overflow-hidden">
            {ledgerQuery.loading && ledgerQuery.rows.length === 0 ? (
              <SkeletonRows rows={3} />
            ) : ledgerQuery.rows.length === 0 ? (
              <EmptyState
                icon="book"
                title={t('khata.history')}
                body={t('khata.emptyHelp')}
              />
            ) : (
              <ul className="divide-y divide-rule/60">
                {ledgerQuery.rows.map((entry) => {
                  const isDebit =
                    entry.entry_type === 'credit_sale' ||
                    entry.entry_type === 'opening_balance' ||
                    entry.entry_type === 'credit_purchase' ||
                    entry.entry_type === 'adjustment'
                  return (
                    <li key={entry.id} className="p-3">
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-center gap-2">
                          <Badge tone={isDebit ? 'warn' : 'ok'}>
                            {entry.entry_type === 'credit_sale'
                              ? t('sell.title')
                              : entry.entry_type === 'payment_received'
                                ? t('khata.collect')
                                : entry.entry_type === 'opening_balance'
                                  ? t('khata.openingBalance')
                                  : entry.entry_type === 'write_off'
                                    ? t('khata.writeOff')
                                    : entry.entry_type}
                          </Badge>
                          <span className="text-ink-faint text-xs">
                            {date(entry.occurred_at, { short: true })}
                          </span>
                        </div>

                        <span
                          className={cn(
                            'tnum font-bold text-base',
                            isDebit ? 'text-warn' : 'text-brand',
                          )}
                        >
                          {isDebit ? '+' : '-'}{money(Math.abs(entry.amount))}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-xs text-ink-soft">
                        <span>
                          {entry.note || (entry.entry_type === 'payment_received' ? t('common.saved') : '')}
                        </span>
                        <span className="tnum">
                          {t('stock.balanceAfter')}: {money(entry.balance_after)}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden">
            {salesQuery.loading && salesQuery.rows.length === 0 ? (
              <SkeletonRows rows={3} />
            ) : salesQuery.rows.length === 0 ? (
              <EmptyState
                icon="cart"
                title={t('sell.title')}
                body={t('home.emptyToday')}
              />
            ) : (
              <ul className="divide-y divide-rule/60">
                {salesQuery.rows.map((sale) => (
                  <li key={sale.id} className="p-3 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm text-ink">
                        {t('sell.invoiceNo', { no: num(sale.invoice_no) })}
                      </p>
                      <p className="text-xs text-ink-faint">
                        {when(sale.sold_at)}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="tnum font-bold text-sm text-ink">{money(sale.total)}</p>
                      {sale.due > 0 ? (
                        <p className="text-xs text-warn">{t('khata.due')}: {money(sale.due)}</p>
                      ) : (
                        <p className="text-xs text-brand">{t('sell.paid')}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Sheets */}
      <CollectPaymentSheet
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
        customer={customer}
        onCollected={() => {
          void customerQuery.refetch()
          void ledgerQuery.refetch()
        }}
      />

      <CustomerSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={customer}
        onSaved={() => {
          void customerQuery.refetch()
        }}
      />

      <OpeningBalanceSheet
        open={openingBalOpen}
        onClose={() => setOpeningBalOpen(false)}
        customer={customer}
        onSaved={() => {
          void customerQuery.refetch()
          void ledgerQuery.refetch()
        }}
      />

      <ReminderSheet
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        customer={customer}
      />

      {confirmElement}
    </Screen>
  )
}
