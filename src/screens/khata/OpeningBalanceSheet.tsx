import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, TextArea } from '@/components/ui/Field'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import type { CustomerDue } from '@/lib/database.types'
import { newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'

export function OpeningBalanceSheet({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  customer: CustomerDue | null
  onSaved?: () => void
}) {
  const { t } = useI18n()
  const { shopId } = useShop()

  const [amount, setAmount] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const opBal = useWrite('set_opening_balance')

  const isValid = amount != null && amount > 0

  async function handleSubmit() {
    if (!customer || !shopId || !isValid) return

    const outcome = await opBal.write({
      args: {
        payload: {
          shop_id: shopId,
          client_uuid: newId(),
          party: 'customer',
          customer_id: customer.id,
          amount: amount,
          entry_type: 'opening_balance',
          note: note.trim() || null,
        },
      },
      amount: amount,
      label: `${t('khata.openingBalance')} — ${customer.name}`,
    })

    if (outcome.ok) {
      onSaved?.()
      onClose()
    }
  }

  if (!customer) return null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('khata.openingBalance')}
      footer={
        <Button
          block
          size="lg"
          variant="primary"
          icon="check"
          loading={opBal.busy}
          disabled={!isValid}
          onClick={() => void handleSubmit()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <p className="text-ink-soft text-sm mb-3">{customer.name}</p>

      <Field label={t('common.amount')} hint={t('khata.openingBalanceHelp')} required>
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
