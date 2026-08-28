import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { EXPENSE_CATEGORIES, EXPENSE_ORDER } from '@/lib/constants'
import type { ExpenseCategory } from '@/lib/database.types'
import { newId } from '@/lib/utils'
import { llmParseExpense, parseSpokenExpense } from '@/lib/voice'
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
  const [aiProcessing, setAiProcessing] = useState(false)

  const voice = useVoiceRecognition({
    lang: 'bn-BD',
    autoStopMs: 2000,
    onResult: (spokenText) => {
      void handleSpokenExpense(spokenText)
    },
  })

  useEffect(() => {
    if (!open) {
      voice.stop()
      setAiProcessing(false)
    }
  }, [open])

  async function handleSpokenExpense(spoken: string) {
    if (!spoken.trim()) return
    setAiProcessing(true)

    // 1. LLM JSON extraction
    const llmResult = await llmParseExpense(spoken)
    if (llmResult) {
      if (llmResult.amount > 0) setAmount(llmResult.amount)
      if (llmResult.category) setCategory(llmResult.category)
      if (llmResult.note) setNote(llmResult.note)
    } else {
      // 2. Regex fallback
      const parsed = parseSpokenExpense(spoken)
      if (parsed.amount > 0) setAmount(parsed.amount)
      if (parsed.category) setCategory(parsed.category)
      if (parsed.note) setNote(parsed.note)
    }

    setAiProcessing(false)
  }

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
      {/* Voice Assistant Strip */}
      <div className="mb-3 p-3 rounded-card bg-canvas border border-rule flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => voice.toggle()}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all shadow-sm ${
              voice.isListening
                ? 'bg-brand text-white scale-105 animate-pulse'
                : 'bg-surface border border-rule text-brand hover:bg-brand-soft'
            }`}
            title="মুখে বলে খরচ পূরণ করুন"
          >
            <Icon name={voice.isListening ? 'mic' : 'micOff'} size={20} />
          </button>
          <div>
            <p className="text-xs font-bold text-ink">
              {voice.isListening ? 'শুনছি... বলুন' : 'মুখে বলে খরচ লিখুন'}
            </p>
            <p className="text-[11px] text-ink-soft">
              {voice.transcript
                ? `"${voice.transcript}"`
                : 'যেমন: "দোকান ভাড়া ৫০০০ টাকা" বা "চা নাস্তা ৬০ টাকা"'}
            </p>
          </div>
        </div>

        {aiProcessing && (
          <span className="text-xs text-brand font-semibold animate-pulse shrink-0">
            AI বিশ্লেষণ করছে...
          </span>
        )}
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

