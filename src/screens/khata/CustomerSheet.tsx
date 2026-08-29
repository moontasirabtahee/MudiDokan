import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, TextArea } from '@/components/ui/Field'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { type CustomerDraft, createCustomer, updateCustomer } from '@/data/parties'
import { useAction } from '@/hooks/useAction'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import type { Customer, CustomerDue } from '@/lib/database.types'
import { cleanPhoneForDialing, isBangladeshiPhone, newId } from '@/lib/utils'
import { invalidateCachePrefix } from '@/offline/db'
import { sync } from '@/offline/sync'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'

export function CustomerSheet({
  open,
  onClose,
  customer,
  initialName = '',
  onSaved,
}: {
  open: boolean
  onClose: () => void
  customer?: CustomerDue | Customer | null
  initialName?: string
  onSaved?: (customer: Customer) => void
}) {
  const { t } = useI18n()
  const { shopId } = useShop()
  const toast = useToast()

  const editing = Boolean(customer)

  const [name, setName] = useState(() => customer?.name ?? initialName)
  const [phone, setPhone] = useState(() => customer?.phone ?? '')
  const [address, setAddress] = useState(() => customer?.address ?? '')
  const [creditLimit, setCreditLimit] = useState<number | null>(() =>
    customer?.credit_limit ? customer.credit_limit : null,
  )
  const [openingBalance, setOpeningBalance] = useState<number | null>(null)
  const [note, setNote] = useState(() => customer?.note ?? '')

  const opBal = useWrite('set_opening_balance')

  const save = useAction(async () => {
    if (!shopId) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.say('error.required', { field: t('common.name') }, { kind: 'error' })
      return
    }

    const cleanedPhone = phone.trim() ? cleanPhoneForDialing(phone.trim()) : null
    if (cleanedPhone && !isBangladeshiPhone(cleanedPhone)) {
      toast.say('error.invalidPhone', undefined, { kind: 'error' })
      return
    }

    const draft: CustomerDraft = {
      name: trimmedName,
      phone: cleanedPhone,
      address: address.trim() || null,
      credit_limit: creditLimit ?? 0,
      note: note.trim() || null,
    }

    let savedCustomer: Customer

    if (customer) {
      savedCustomer = await updateCustomer(customer.id, draft)
      toast.say('common.saved')
    } else {
      savedCustomer = await createCustomer(shopId, draft)
      toast.say('common.saved')

      // Record opening balance if given
      if (openingBalance && openingBalance > 0) {
        await opBal.write({
          args: {
            payload: {
              shop_id: shopId,
              client_uuid: newId(),
              party: 'customer',
              customer_id: savedCustomer.id,
              amount: openingBalance,
              entry_type: 'opening_balance',
              note: null,
              occurred_at: new Date().toISOString(),
            },
          },
          amount: openingBalance,
          label: `${t('khata.openingBalance')} — ${savedCustomer.name}`,
        })
      }
    }

    await invalidateCachePrefix(shopId, 'party:')
    void sync.refresh()

    onSaved?.(savedCustomer)
    onClose()
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? t('common.edit') : t('khata.addCustomer')}
      footer={
        <Button
          block
          size="lg"
          variant="primary"
          icon="check"
          loading={save.busy}
          onClick={() => void save.run()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <Field label={t('common.name')} required>
        {({ id: nameId, describedBy, invalid }) => (
          <Input
            id={nameId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('khata.customerName')}
            autoFocus={!editing}
          />
        )}
      </Field>

      <Field label={t('common.phone')} optional className="mt-3">
        {({ id: phoneId, describedBy, invalid }) => (
          <Input
            id={phoneId}
            aria-describedby={describedBy}
            invalid={invalid}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="017XXXXXXXX"
          />
        )}
      </Field>

      <Field label={t('common.address')} optional className="mt-3">
        {({ id: addrId, describedBy, invalid }) => (
          <Input
            id={addrId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t('common.address')}
          />
        )}
      </Field>

      <Field label={t('khata.creditLimit')} hint={t('khata.creditLimitHelp')} optional className="mt-3">
        {({ id: limitId, describedBy, invalid }) => (
          <AmountField
            id={limitId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={creditLimit}
            onChange={setCreditLimit}
          />
        )}
      </Field>

      {!editing ? (
        <Field label={t('khata.openingBalance')} hint={t('khata.openingBalanceHelp')} optional className="mt-3">
          {({ id: openBalId, describedBy, invalid }) => (
            <AmountField
              id={openBalId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={openingBalance}
              onChange={setOpeningBalance}
            />
          )}
        </Field>
      ) : null}

      <Field label={t('common.note')} optional className="mt-3">
        {({ id: noteId, describedBy, invalid }) => (
          <TextArea
            id={noteId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('common.note')}
          />
        )}
      </Field>
    </Sheet>
  )
}
