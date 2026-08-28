import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { EXPENSE_CATEGORIES, EXPENSE_ORDER } from '@/lib/constants'
import type { ExpenseCategory } from '@/lib/database.types'
import { newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'

export function ExpenseSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const { t, locale } = useI18n()
  const { shopId } = useShop()

  const [category, setCategory] = useState<ExpenseCategory>('refreshment')
  const [amount, setAmount] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const expenseWrite = useWrite('create_expense', {
    success: 'expense.saved',
  })

  const isValid = amount != null && amount > 0

  async function handleSave() {
    if (!shopId || !isValid) return

    const outcome = await expenseWrite.write({
      args: {
        payload: {
          shop_id: shopId,
          client_uuid: newId(),
          category,
          amount: amount,
          note: note.trim() || null,
          spent_at: new Date().toISOString(),
        },
      },
      amount: amount,
      label: `${t('expense.title')} — ${EXPENSE_CATEGORIES[category][locale]}`,
    })

    if (outcome.ok) {
      onSaved?.()
      onClose()
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('expense.add')}
      footer={
        <Button
          block
          size="lg"
          variant="primary"
          icon="check"
          loading={expenseWrite.busy}
          disabled={!isValid}
          onClick={() => void handleSave()}
        >
          {t('common.save')}
        </Button>
      }
    >
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

      <Field label={t('expense.category')} className="mt-3">
        {() => (
          <div className="grid grid-cols-2 gap-2">
            {EXPENSE_ORDER.map((cat) => {
              const item = EXPENSE_CATEGORIES[cat]
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`flex items-center gap-2 rounded-field border p-2.5 text-sm font-medium transition-all ${
                    category === cat
                      ? 'border-brand bg-brand-soft text-brand-deep font-semibold'
                      : 'border-rule bg-surface text-ink hover:bg-canvas'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item[locale]}</span>
                </button>
              )
            })}
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
