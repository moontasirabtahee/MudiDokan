import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, TextArea } from '@/components/ui/Field'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { type SupplierDraft, createSupplier, updateSupplier } from '@/data/parties'
import { useAction } from '@/hooks/useAction'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import type { Supplier, SupplierDue } from '@/lib/database.types'
import { cleanPhoneForDialing, isBangladeshiPhone, newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'

export function SupplierSheet({
  open,
  onClose,
  supplier,
  initialName = '',
  onSaved,
}: {
  open: boolean
  onClose: () => void
  supplier?: SupplierDue | Supplier | null
  initialName?: string
  onSaved?: (supplier: Supplier) => void
}) {
  const { t } = useI18n()
  const { shopId } = useShop()
  const toast = useToast()

  const editing = Boolean(supplier)

  const [name, setName] = useState(() => supplier?.name ?? initialName)
  const [company, setCompany] = useState(() => supplier?.company ?? '')
  const [phone, setPhone] = useState(() => supplier?.phone ?? '')
  const [address, setAddress] = useState(() => supplier?.address ?? '')
  const [openingBalance, setOpeningBalance] = useState<number | null>(null)
  const [note, setNote] = useState(() => supplier?.note ?? '')

  const opBal = useWrite('set_opening_balance')

  const save = useAction(async () => {
    if (!shopId) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.say('error.required', { field: t('supplier.name') }, { kind: 'error' })
      return
    }

    const cleanedPhone = phone.trim() ? cleanPhoneForDialing(phone.trim()) : null
    if (cleanedPhone && !isBangladeshiPhone(cleanedPhone)) {
      toast.say('error.invalidPhone', undefined, { kind: 'error' })
      return
    }

    const draft: SupplierDraft = {
      name: trimmedName,
      company: company.trim() || null,
      phone: cleanedPhone,
      address: address.trim() || null,
      note: note.trim() || null,
    }

    let savedSupplier: Supplier

    if (supplier) {
      savedSupplier = await updateSupplier(supplier.id, draft)
      toast.say('common.saved')
    } else {
      savedSupplier = await createSupplier(shopId, draft)
      toast.say('common.saved')

      if (openingBalance && openingBalance > 0) {
        await opBal.write({
          args: {
            payload: {
              shop_id: shopId,
              client_uuid: newId(),
              party: 'supplier',
              supplier_id: savedSupplier.id,
              amount: openingBalance,
              entry_type: 'opening_balance',
              note: null,
              occurred_at: new Date().toISOString(),
            },
          },
          amount: openingBalance,
          label: `${t('khata.openingBalance')} — ${savedSupplier.name}`,
        })
      }
    }

    onSaved?.(savedSupplier)
    onClose()
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? t('common.edit') : t('supplier.add')}
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
      <Field label={t('supplier.name')} required>
        {({ id: nameId, describedBy, invalid }) => (
          <Input
            id={nameId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('supplier.name')}
            autoFocus={!editing}
          />
        )}
      </Field>

      <Field label={t('supplier.company')} optional className="mt-3">
        {({ id: compId, describedBy, invalid }) => (
          <Input
            id={compId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder={t('supplier.company')}
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
