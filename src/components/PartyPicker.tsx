import { useMemo, useState } from 'react'
import { type CustomerDraft, createCustomer, listCustomerDues, listSupplierDues } from '@/data/parties'
import { useQueryList } from '@/hooks/useQuery'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessage } from '@/i18n/strings'
import type { CustomerDue, SupplierDue } from '@/lib/database.types'
import { matchesSearch, newId, searchRank } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import { Button } from '@/components/ui/Button'
import { Field, Input, SearchInput } from '@/components/ui/Field'
import { Badge, Divider, EmptyState, Row, SkeletonRows } from '@/components/ui/Feedback'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'

/**
 * Choose a customer or a supplier, or add one.
 *
 * One component for both because the interaction is identical and the two lists
 * differ only in which balance they show. It is used from the sell screen, the
 * khata, and the purchase screen.
 *
 * The search matches Bengali and English against name, phone and company, folded
 * through `foldForSearch` so that "রহিম", "rohim" and "01712" all find the same
 * person. That matters more than it sounds: a shopkeeper knows his customers by
 * face and by phone number, and half the names in a khata are spelled two ways.
 */
export function PartyPicker({
  open,
  onClose,
  party,
  onPick,
  /** Shown for the walk-in case. Omit for suppliers, where there is no such thing. */
  anonymousLabel,
}: {
  open: boolean
  onClose: () => void
  party: 'customer' | 'supplier'
  onPick: (id: string | null, name: string) => void
  anonymousLabel?: string
}) {
  const { t, money, phone: fmtPhone } = useI18n()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  type PickerRow = CustomerDue | SupplierDue

  const list = useQueryList<PickerRow>(
    open ? (party === 'customer' ? 'party:customers' : 'party:suppliers') : null,
    (shopId) => (party === 'customer' ? listCustomerDues(shopId) : listSupplierDues(shopId)),
    { staleMs: 60_000, onSync: true },
  )

  const rows = useMemo(() => {
    const filtered = list.rows.filter((row) =>
      matchesSearch(query, row.name, row.phone, 'company' in row ? (row.company as string | null) : null),
    )
    return filtered
      .slice()
      .sort((a, b) => searchRank(query, a.name, a.phone) - searchRank(query, b.name, b.phone))
      .slice(0, 60)
  }, [list.rows, query])

  function pick(id: string | null, name: string) {
    onPick(id, name)
    setQuery('')
    onClose()
  }

  if (adding) {
    return (
      <NewCustomerSheet
        open={open}
        onClose={() => setAdding(false)}
        initialName={query}
        onCreated={(id, name) => {
          setAdding(false)
          pick(id, name)
        }}
      />
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={party === 'customer' ? t('sell.chooseCustomer') : t('purchase.supplier')}
      footer={
        party === 'customer' ? (
          <Button block size="lg" icon="plus" onClick={() => setAdding(true)}>
            {t('khata.addCustomer')}
          </Button>
        ) : undefined
      }
    >
      <SearchInput value={query} onChange={setQuery} autoFocus />

      {anonymousLabel ? (
        <>
          <Row
            className="mt-2"
            onClick={() => pick(null, anonymousLabel)}
            leading={
              <span className="bg-paper text-ink-soft flex h-10 w-10 items-center justify-center rounded-pill text-sm">
                —
              </span>
            }
            title={anonymousLabel}
          />
          <Divider />
        </>
      ) : null}

      {list.loading && rows.length === 0 ? (
        <SkeletonRows rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="user"
          title={t('khata.empty')}
          body={query ? undefined : t('khata.emptyHelp')}
        />
      ) : (
        rows.map((row, index) => (
          <div key={row.id}>
            {index > 0 ? <Divider inset /> : null}
            <Row
              onClick={() => pick(row.id, row.name)}
              leading={
                <span className="bg-brand-soft text-brand-deep flex h-10 w-10 items-center justify-center rounded-pill text-sm font-semibold">
                  {row.name.slice(0, 1)}
                </span>
              }
              title={row.name}
              subtitle={row.phone ? fmtPhone(row.phone) : undefined}
              trailing={
                row.due_balance > 0 ? (
                  <Badge tone="warn">{money(row.due_balance)}</Badge>
                ) : row.due_balance < 0 ? (
                  <Badge tone="brand">{money(-row.due_balance)}</Badge>
                ) : undefined
              }
            />
          </div>
        ))
      )}
    </Sheet>
  )
}

/**
 * Add a customer.
 *
 * This is one of the two writes in the app that needs a connection, and the sheet
 * says so rather than pretending. The id has to come back from the database because
 * the very next thing that happens is a credit sale against it, and a queued
 * customer would produce a queued sale pointing at a row that may never exist —
 * a corrupted khata rather than a delayed one.
 *
 * The opening balance field is what makes this usable on day one. Nobody starts
 * with an empty khata; they start with a paper one that says Rahim owes ৳৪৫০. Making
 * them ring up a fake sale to record that is how a migration goes wrong.
 */
export function NewCustomerSheet({
  open,
  onClose,
  initialName = '',
  onCreated,
}: {
  open: boolean
  onClose: () => void
  initialName?: string
  onCreated: (id: string, name: string) => void
}) {
  const { t, locale } = useI18n()
  const { shopId, can } = useShop()
  const toast = useToast()
  // Queueable, unlike the customer row itself. See the comment in `submit` below.
  const openingWrite = useWrite('set_opening_balance', { success: null, queued: null })
  // A cashier can add a customer but not restate a balance, which is a ledger
  // correction. Hiding the field beats offering it and refusing it.
  const mayOpen = can('manager')

  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState('')
  const [limit, setLimit] = useState<number | null>(null)
  const [opening, setOpening] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (busy || !shopId) return
    if (name.trim().length < 2) {
      setError(t('error.required'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const draft: CustomerDraft = {
        name: name.trim(),
        phone: phone.trim() || null,
        credit_limit: limit ?? 0,
      }
      const customer = await createCustomer(shopId, draft)

      // The opening balance goes through the outbox, and it is fine for it to lag:
      // the customer row already exists, so nothing downstream is left pointing at
      // a ghost. Deliberately not folded into the failure path above — a customer
      // created without their old balance is fixed in one tap from their statement,
      // whereas failing the whole sheet throws away the name just typed.
      if (mayOpen && opening && opening > 0) {
        await openingWrite.write({
          args: {
            payload: {
              shop_id: shopId,
              client_uuid: newId(),
              party: 'customer',
              customer_id: customer.id,
              amount: opening,
              occurred_at: new Date().toISOString(),
            },
          },
          amount: opening,
        })
      }

      toast.say('common.saved')
      onCreated(customer.id, customer.name)
      setName('')
      setPhone('')
      setLimit(null)
      setOpening(null)
    } catch (thrown) {
      setError(errorMessage(locale, thrown))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('khata.addCustomer')}
      footer={
        <Button variant="primary" block size="lg" loading={busy} onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t('khata.customerName')} error={error} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          )}
        </Field>

        <Field label={t('common.phone')} optional>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="01XXXXXXXXX"
            />
          )}
        </Field>

        {mayOpen ? (
          <Field label={t('khata.openingBalance')} hint={t('khata.openingBalanceHelp')} optional>
            {({ id, describedBy }) => (
              <AmountField id={id} aria-describedby={describedBy} value={opening} onChange={setOpening} />
            )}
          </Field>
        ) : null}

        <Field label={t('khata.creditLimit')} hint={t('khata.creditLimitHelp')} optional>
          {({ id, describedBy }) => (
            <AmountField id={id} aria-describedby={describedBy} value={limit} onChange={setLimit} />
          )}
        </Field>
      </div>
    </Sheet>
  )
}
