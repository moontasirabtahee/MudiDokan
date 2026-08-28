import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, TextArea } from '@/components/ui/Field'
import { Badge } from '@/components/ui/Feedback'
import { QtyField } from '@/components/ui/NumberField'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { ADJUST_REASONS } from '@/lib/constants'
import type { ProductStatus, StockReason } from '@/lib/database.types'
import { newId } from '@/lib/utils'
import { invalidateCacheKey, invalidateCachePrefix } from '@/offline/db'
import { useShop } from '@/providers/ShopProvider'
import {
  type AdjustMode,
  balanceAfter,
  checkAdjust,
  deltaOf,
  emptyAdjust,
  toAdjustPayload,
} from './adjust'

/** The reasons a loss can have. Counting the shelf is the other mode, not a reason. */
const LOSS_REASONS = ADJUST_REASONS.filter((reason) => reason.value !== 'correction')

/**
 * Correcting the stock.
 *
 * The two modes are not a preference — they are two different events, and the sheet
 * opens on whichever one the shopkeeper's situation is. Counting is the default because
 * it is the one that happens on a schedule; a loss happens when it happens.
 *
 * The resulting balance sits above the save button at all times, in words the
 * shopkeeper can check against the shelf he is looking at. That number is the whole
 * confirmation step: no summary screen, no "are you sure" — he can already see what the
 * app is about to believe.
 */
export function AdjustSheet({
  open,
  product,
  onClose,
  onDone,
}: {
  open: boolean
  product: ProductStatus | null
  onClose: () => void
  onDone?: () => void
}) {
  const { t, qty, num } = useI18n()
  const { shopId } = useShop()
  const [state, setState] = useState(() => emptyAdjust('count'))

  // Only the confirmed case says "stock corrected". `products.stock` is written by a
  // trigger, so a queued correction has not moved the number yet — and the number is
  // still on screen behind this sheet. The default queued toast tells the truth: it is
  // on the phone and it will send itself.
  const write = useWrite('adjust_stock', { success: 'stock.adjusted' })

  const current = product?.stock ?? 0
  const check = useMemo(() => checkAdjust(state, current), [state, current])
  const delta = deltaOf(state, current)
  const after = balanceAfter(state, current)

  function close() {
    setState(emptyAdjust('count'))
    onClose()
  }

  async function save() {
    if (!product || !shopId || !check.ok) return
    const payload = toAdjustPayload(state, {
      shopId,
      productId: product.id,
      current,
      clientUuid: newId(),
    })
    const out = await write.write({ args: { payload } })
    if (out.ok) {
      void invalidateCacheKey(shopId, 'products:catalog')
      void invalidateCacheKey(shopId, `product:${product.id}`)
      void invalidateCacheKey(shopId, 'dashboard:today')
      void invalidateCachePrefix(shopId, 'products:')
      close()
      onDone?.()
    }
  }

  const modes = [
    { value: 'count' as AdjustMode, label: t('stock.countMode') },
    { value: 'remove' as AdjustMode, label: t('stock.removeMode') },
  ]

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('stock.adjust')}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          loading={write.busy}
          disabled={!check.ok || !write.allowed}
          onClick={save}
        >
          {t('common.save')}
        </Button>
      }
    >
      <p className="text-ink-soft text-sm">{t('stock.adjustHelp')}</p>

      <div className="bg-paper ring-rule mt-3 flex items-baseline justify-between rounded-card px-3.5 py-2.5 ring-1">
        <span className="text-ink-soft text-sm">{t('stock.current')}</span>
        <span className="tnum text-ink text-lg font-semibold">
          {qty(current, product?.unit)}
        </span>
      </div>

      <Segmented
        value={state.mode}
        onChange={(mode) => setState({ ...emptyAdjust(mode), note: state.note })}
        options={modes}
        label={t('stock.adjust')}
        className="mt-3"
      />

      {state.mode === 'count' ? (
        <Field label={t('stock.counted')} className="mt-3">
          {({ id }) => (
            <QtyField
              id={id}
              value={state.counted}
              onChange={(counted) => setState({ ...state, counted })}
              unit={product?.unit}
              weighted={product?.is_weighted ?? false}
              autoFocus
            />
          )}
        </Field>
      ) : (
        <>
          <Field label={t('common.qty')} className="mt-3">
            {({ id }) => (
              <QtyField
                id={id}
                value={state.amount}
                onChange={(amount) => setState({ ...state, amount })}
                unit={product?.unit}
                weighted={product?.is_weighted ?? false}
                autoFocus
              />
            )}
          </Field>

          {/* Buttons rather than a dropdown: four reasons, and the one that applies is
              usually obvious the moment it is on screen. A `<select>` here would hide
              all four behind a tap and cost the shopkeeper the recognition.

              'গণনা সংশোধন' is filtered out because that is what the other mode is. A
              reason that duplicates a mode invites the shopkeeper to pick it and then
              do the subtraction himself, which is the work this screen exists to
              take off him. */}
          <Field label={t('stock.reason')} className="mt-3">
            {() => (
              <div className="grid grid-cols-2 gap-2">
                {LOSS_REASONS.map((reason) => (
                  <ReasonButton
                    key={reason.value}
                    value={reason.value}
                    chosen={state.reason === reason.value}
                    onPick={(next) => setState({ ...state, reason: next })}
                  />
                ))}
              </div>
            )}
          </Field>
        </>
      )}

      <Field label={t('common.note')} optional className="mt-3">
        {({ id }) => (
          <TextArea
            id={id}
            rows={2}
            value={state.note}
            onChange={(event) => setState({ ...state, note: event.target.value })}
          />
        )}
      </Field>

      {/* The difference and the result, always visible, never behind a confirm step. */}
      <div className="bg-brand-soft mt-4 rounded-card px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-ink-soft text-sm">{t('stock.difference')}</span>
          <span className="tnum text-ink text-base font-medium">
            {delta > 0 ? '+' : ''}
            {num(delta)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-ink-soft text-sm">{t('stock.balanceAfter')}</span>
          <span className="tnum text-ink text-2xl font-bold">{qty(after, product?.unit)}</span>
        </div>
      </div>

      {check.error ? (
        <p className="text-ink-soft mt-3 text-center text-sm">{t(check.error)}</p>
      ) : null}

      {check.advisories.map((key) => (
        <p key={key} className="bg-warn-soft text-ink ring-warn/40 mt-3 rounded-card px-3.5 py-2.5 text-sm ring-1">
          {t(key)}
        </p>
      ))}
    </Sheet>
  )
}

/** A reason, as a tile. Kept out of the map body so the chosen state reads plainly. */
function ReasonButton({
  value,
  chosen,
  onPick,
}: {
  value: StockReason
  chosen: boolean
  onPick: (next: StockReason) => void
}) {
  const { locale } = useI18n()
  const reason = ADJUST_REASONS.find((option) => option.value === value)
  if (!reason) return null

  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      aria-pressed={chosen}
      className={
        chosen
          ? 'bg-brand min-h-tap flex items-center gap-2 rounded-card px-3 text-start text-sm font-semibold text-white'
          : 'bg-paper ring-rule text-ink min-h-tap flex items-center gap-2 rounded-card px-3 text-start text-sm ring-1'
      }
    >
      <span aria-hidden="true">{reason.icon}</span>
      {locale === 'bn' ? reason.bn : reason.en}
    </button>
  )
}

/** The badge a ledger row wears, so 'in' and 'out' are legible without reading. */
export function DeltaBadge({ delta }: { delta: number }) {
  const { t, num } = useI18n()
  const isIn = delta > 0
  return (
    <Badge tone={isIn ? 'ok' : 'danger'} icon={isIn ? 'down' : 'up'}>
      {t(isIn ? 'stock.in' : 'stock.out')} {num(Math.abs(delta))}
    </Badge>
  )
}
