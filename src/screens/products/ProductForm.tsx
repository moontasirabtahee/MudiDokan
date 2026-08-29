import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, Select, Switch, TextArea } from '@/components/ui/Field'
import { Badge, Divider, ErrorState, Row, Section, SkeletonRows } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { AmountField, NumericField } from '@/components/ui/NumberField'
import { Sheet, useConfirm } from '@/components/ui/Sheet'
import {
  createCategory,
  createProduct,
  getProduct,
  listCategories,
  listStockLedger,
  updateProduct,
} from '@/data/products'
import { useAction } from '@/hooks/useAction'
import { useQuery, useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROUTES, STOCK_REASONS, UNIT_OPTIONS } from '@/lib/constants'
import type { UnitType } from '@/lib/database.types'
import { useShop } from '@/providers/ShopProvider'
import { BarcodeScannerModal } from '@/components/scanner/BarcodeScannerModal'
import { AdjustSheet, DeltaBadge } from './AdjustSheet'
import {
  type DraftState,
  draftFromProduct,
  emptyDraft,
  isDirty,
  marginOf,
  setUnit,
  toProductDraft,
  validateDraft,
} from './draft'

/**
 * One screen for adding a product and for editing one.
 *
 * They are the same form with the same rules, and splitting them would mean keeping two
 * copies of "which fields block a save" in step forever. The only real differences are
 * what the title says, which call saves it, and that an existing product also has a
 * stock figure and a history worth showing.
 *
 * The form is ordered by what a shopkeeper knows without looking anything up: name,
 * then the two prices, then everything optional. Prices sit high because they are the
 * reason the product is being entered at all, and the margin appears between them the
 * moment both are filled — the number he would otherwise work out in his head, and the
 * one that catches a ৮ typed where ৮০ was meant.
 */
export default function ProductForm() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t, locale, money, num, today } = useI18n()
  const { can, shopId } = useShop()
  const [confirm, confirmElement] = useConfirm()

  const editing = Boolean(id)
  const mayEdit = can('manager')

  // The name typed into the search box that found nothing. Carrying it in means the one
  // moment a shopkeeper is definitely willing to fill in a form does not begin with him
  // typing the same word a second time.
  const seeded = useMemo(() => emptyDraft(params.get('name') ?? ''), [params])

  const [state, setState] = useState<DraftState>(seeded)
  const [original, setOriginal] = useState<DraftState>(seeded)
  const [adjusting, setAdjusting] = useState(false)
  const [addingCategory, setAddingCategory] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const product = useQuery(id ? `product:${id}` : null, () => getProduct(id!), {
    enabled: editing,
  })
  const categories = useQueryList('categories', listCategories, { staleMs: 300_000 })

  /**
   * Load the product into the form exactly once.
   *
   * `useQuery` refetches on sync events, on reconnect, and on the tab becoming visible
   * again — which is precisely what a shopkeeper does when he puts the phone down to go
   * and find the packet he is entering. Without this guard that refetch would overwrite
   * everything he had typed, and he would have no idea why.
   */
  const loaded = useRef<string | null>(null)
  useEffect(() => {
    const row = product.data
    if (!row || loaded.current === row.id) return
    loaded.current = row.id
    const next = draftFromProduct(row)
    setState(next)
    setOriginal(next)
  }, [product.data])

  const check = validateDraft(state, today())
  const margin = marginOf(state)
  const dirty = isDirty(state, original)

  const save = useAction(
    async (draft: DraftState, shop: string) => {
      const payload = toProductDraft(draft)
      return id ? await updateProduct(id, payload) : await createProduct(shop, payload)
    },
    { role: 'manager', success: 'common.saved' },
  )

  const retire = useAction((next: boolean) => updateProduct(id!, { is_active: next }), {
    role: 'manager',
    success: 'common.saved',
  })

  // Quiet on success: the new category is already selected in the box behind the sheet,
  // which is a better confirmation than a toast saying the same thing.
  const category = useAction((name: string, shop: string) => createCategory(shop, name), {
    role: 'manager',
    success: null,
  })

  async function submit() {
    if (!check.ok || !shopId) return
    const out = await save.run(state, shopId)
    if (!out.ok) return
    // Editing stays put — the next thing he wants is often to correct the stock, and
    // bouncing him to the list would cost him the row he was already looking at. Adding
    // goes back, because the reason he opened the form was to return to what he was
    // doing before it.
    if (editing) setOriginal(state)
    else navigate(ROUTES.products, { replace: true })
  }

  async function leave() {
    if (dirty) {
      const go = await confirm({
        title: t('common.leaveUnsaved'),
        body: t('common.leaveUnsavedWarn'),
        confirmLabel: t('common.leave'),
        danger: true,
      })
      if (!go) return
    }
    navigate(-1)
  }

  async function toggleActive() {
    const row = product.data
    if (!row) return
    const next = !row.is_active
    if (!next) {
      const go = await confirm({
        title: t('product.retire'),
        body: t('product.deleteWarning'),
        confirmLabel: t('product.retire'),
        danger: true,
      })
      if (!go) return
    }
    const out = await retire.run(next)
    if (out.ok) await product.refetch()
  }

  if (editing && product.error && !product.data) {
    return (
      <Screen title={t('product.edit')} back>
        <ErrorState message={product.error} onRetry={product.refetch} />
      </Screen>
    )
  }

  return (
    <Screen
      title={editing ? t('product.edit') : t('product.add')}
      back={() => void leave()}
      footer={
        mayEdit ? (
          <Button
            variant="primary"
            size="lg"
            block
            icon="check"
            loading={save.busy}
            disabled={!check.ok || (editing && !dirty)}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        ) : undefined
      }
    >
      {editing && product.loading && !product.data ? (
        <div className="card overflow-hidden">
          <SkeletonRows rows={5} />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── What it is ───────────────────────────────────────────────── */}
          <div className="card space-y-4 p-3.5">
            {/* The required name first, whichever script it is typed in. `displayName`
                prefers `name_bn` and falls back to this, so a shopkeeper who types
                Bengali here and leaves the next box empty still reads Bengali
                everywhere in the app. */}
            <Field
              label={t('product.name')}
              error={check.errors.name ? t(check.errors.name) : null}
              required
            >
              {({ id: fieldId, describedBy, invalid }) => (
                <Input
                  id={fieldId}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={state.name}
                  onChange={(event) => setState({ ...state, name: event.target.value })}
                  autoFocus={!editing}
                  disabled={!mayEdit}
                />
              )}
            </Field>

            <Field label={t('product.nameBn')} optional>
              {({ id: fieldId }) => (
                <Input
                  id={fieldId}
                  value={state.name_bn}
                  onChange={(event) => setState({ ...state, name_bn: event.target.value })}
                  disabled={!mayEdit}
                />
              )}
            </Field>

            <Field label={t('product.category')} optional>
              {({ id: fieldId }) => (
                <div className="flex gap-2">
                  <Select
                    id={fieldId}
                    className="flex-1"
                    value={state.category_id ?? ''}
                    onChange={(event) =>
                      setState({ ...state, category_id: event.target.value || null })
                    }
                    disabled={!mayEdit}
                  >
                    <option value="">{t('common.none')}</option>
                    {categories.rows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </Select>
                  {mayEdit ? (
                    <IconButton
                      name="plus"
                      label={t('product.newCategory')}
                      variant="secondary"
                      onClick={() => setAddingCategory(true)}
                    />
                  ) : null}
                </div>
              )}
            </Field>
          </div>

          {/* ── What it costs and what it sells for ──────────────────────── */}
          <div className="card space-y-4 p-3.5">
            <div className={mayEdit ? 'grid grid-cols-2 gap-3' : ''}>
              {mayEdit ? (
                <Field
                  label={t('product.buyPrice')}
                  error={check.errors.buy_price ? t(check.errors.buy_price) : null}
                >
                  {({ id: fieldId, describedBy, invalid }) => (
                    <AmountField
                      id={fieldId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={state.buy_price}
                      onChange={(buy_price) => setState({ ...state, buy_price })}
                    />
                  )}
                </Field>
              ) : null}

              <Field
                label={t('product.sellPrice')}
                error={check.errors.sell_price ? t(check.errors.sell_price) : null}
                required
              >
                {({ id: fieldId, describedBy, invalid }) => (
                  <AmountField
                    id={fieldId}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={state.sell_price}
                    onChange={(sell_price) => setState({ ...state, sell_price })}
                    disabled={!mayEdit}
                  />
                )}
              </Field>
            </div>

            {/* Margin is owner/manager only */}
            {mayEdit && state.sell_price !== null ? (
              <div className="bg-brand-soft flex items-baseline justify-between rounded-card px-3 py-2">
                <span className="text-ink-soft text-sm">{t('product.margin')}</span>
                <span className="tnum text-ink text-base font-semibold">
                  {money(margin.amount)}
                  {margin.pct !== null ? (
                    <span className="text-ink-soft ms-1.5 text-sm font-normal">
                      ({num(margin.pct)}%)
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>

          {/* ── How it is sold ───────────────────────────────────────────── */}
          <div className="card space-y-4 p-3.5">
            <Field label={t('common.unit')}>
              {({ id: fieldId }) => (
                <Select
                  id={fieldId}
                  value={state.unit}
                  onChange={(event) => setState(setUnit(state, event.target.value as UnitType))}
                  disabled={!mayEdit}
                >
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {locale === 'bn' ? option.bn : option.en}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/* Left on screen even though the unit sets it. Loose sweets sold by the
                piece and packets sold by the kilo both exist, so this is a correction to
                a good guess rather than a question nobody can answer. */}
            <Switch
              checked={state.is_weighted}
              onChange={(is_weighted) => setState({ ...state, is_weighted })}
              label={t('product.weighed')}
              hint={t('product.weighedHelp')}
              disabled={!mayEdit}
            />

            <Field
              label={t('product.lowStockAt')}
              error={check.errors.low_stock_threshold ? t(check.errors.low_stock_threshold) : null}
            >
              {({ id: fieldId, describedBy, invalid }) => (
                <NumericField
                  id={fieldId}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={state.low_stock_threshold}
                  onChange={(low_stock_threshold) => setState({ ...state, low_stock_threshold })}
                  decimals={state.is_weighted ? 3 : 0}
                  disabled={!mayEdit}
                />
              )}
            </Field>

            {!editing ? (
              <Field label={t('product.openingStock')} optional>
                {({ id: fieldId, describedBy, invalid }) => (
                  <NumericField
                    id={fieldId}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={state.opening_stock ?? null}
                    onChange={(opening_stock) => setState({ ...state, opening_stock })}
                    decimals={state.is_weighted ? 3 : 0}
                    disabled={!mayEdit}
                  />
                )}
              </Field>
            ) : null}
          </div>

          {/* ── The rest, which most products never need ─────────────────── */}
          <Section title={t('common.optional')}>
            <div className="card space-y-4 p-3.5">
              <Field label={t('product.expiry')} optional>
                {({ id: fieldId }) => (
                  <Input
                    id={fieldId}
                    type="date"
                    value={state.expiry_date}
                    onChange={(event) => setState({ ...state, expiry_date: event.target.value })}
                    disabled={!mayEdit}
                  />
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('product.sku')} optional>
                  {({ id: fieldId }) => (
                    <Input
                      id={fieldId}
                      value={state.sku}
                      onChange={(event) => setState({ ...state, sku: event.target.value })}
                      disabled={!mayEdit}
                    />
                  )}
                </Field>
                <Field label={t('product.barcode')} optional>
                  {({ id: fieldId }) => (
                    <div className="flex gap-1.5">
                      <Input
                        id={fieldId}
                        inputMode="numeric"
                        value={state.barcode}
                        onChange={(event) => setState({ ...state, barcode: event.target.value })}
                        disabled={!mayEdit}
                        className="font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setScannerOpen(true)}
                        title="ক্যামেরা দিয়ে স্ক্যান করুন"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-rule bg-canvas/60 text-brand hover:bg-brand-soft"
                      >
                        <Icon name="barcode" size={20} />
                      </button>
                    </div>
                  )}
                </Field>
              </div>

              <Field label={t('common.note')} optional>
                {({ id: fieldId }) => (
                  <TextArea
                    id={fieldId}
                    rows={2}
                    value={state.note}
                    onChange={(event) => setState({ ...state, note: event.target.value })}
                    disabled={!mayEdit}
                  />
                )}
              </Field>
            </div>
          </Section>

          {/* Advisories go immediately above the save button, where they will be read.
              Never in a field's error slot: a box painted red for a decision the
              shopkeeper is entitled to make teaches him that red means nothing. */}
          {check.advisories.length > 0 ? (
            <div className="bg-warn-soft text-ink ring-warn/40 space-y-1.5 rounded-card px-3.5 py-3 ring-1">
              {check.advisories.map((key) => (
                <p key={key} className="text-sm">
                  {t(key)}
                </p>
              ))}
            </div>
          ) : null}

          {editing && product.data ? (
            <>
              <StockPanel
                stock={product.data.stock}
                unit={product.data.unit}
                active={product.data.is_active}
                mayEdit={mayEdit}
                busy={retire.busy}
                onAdjust={() => setAdjusting(true)}
                onToggle={() => void toggleActive()}
              />
              <Movements productId={product.data.id} unit={product.data.unit} />
            </>
          ) : (
            <p className="text-ink-faint px-1 pb-2 text-xs">{t('product.openingStockHint')}</p>
          )}
        </div>
      )}

      <NewCategorySheet
        open={addingCategory}
        busy={category.busy}
        onClose={() => setAddingCategory(false)}
        onCreate={async (name) => {
          if (!shopId) return
          const out = await category.run(name, shopId)
          if (!out.ok || !out.result) return
          setState({ ...state, category_id: out.result.id })
          setAddingCategory(false)
          await categories.refetch()
        }}
      />

      <AdjustSheet
        open={adjusting}
        product={product.data}
        onClose={() => setAdjusting(false)}
        onDone={() => void product.refetch()}
      />

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(scanned) => setState({ ...state, barcode: scanned })}
        title="পণ্যের বারকোড স্ক্যান"
      />

      {confirmElement}
    </Screen>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────────── */

/**
 * Stock, read-only, with the one honest way to change it beside it.
 *
 * The number is not a field. `products.stock` is a trigger-maintained total over
 * `stock_ledger`, and letting anyone type over it would produce a figure with no
 * movement behind it — which is exactly the hole in the paper ledger this app exists to
 * close. So it is displayed, and changing it means saying why.
 */
function StockPanel({
  stock,
  unit,
  active,
  mayEdit,
  busy,
  onAdjust,
  onToggle,
}: {
  stock: number
  unit: string
  active: boolean
  mayEdit: boolean
  busy: boolean
  onAdjust: () => void
  onToggle: () => void
}) {
  const { t, qty } = useI18n()

  return (
    <Section title={t('product.stock')}>
      <div className="card overflow-hidden">
        <Row
          title={t('stock.current')}
          trailing={qty(stock, unit)}
          trailingSub={active ? undefined : <Badge tone="neutral">{t('product.inactive')}</Badge>}
        />
        {mayEdit ? (
          <>
            <Divider />
            <div className="flex gap-2 p-3">
              <Button icon="scale" block onClick={onAdjust}>
                {t('stock.adjust')}
              </Button>
              <Button
                variant={active ? 'ghost' : 'secondary'}
                block
                loading={busy}
                onClick={onToggle}
              >
                {t(active ? 'product.retire' : 'product.restore')}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Section>
  )
}

/**
 * Where the stock went.
 *
 * Its own query rather than part of the product fetch, because it is the one thing on
 * this screen nobody opens the form to see — and on a product that has been selling for
 * a year it is by far the largest payload. Separately, the form paints on the first
 * render and this fills in behind it.
 *
 * Each row carries the balance the shop was left with, not only the movement. A ledger
 * that shows −৩ and −২ and −৭ makes the shopkeeper add them up to check the total he
 * disputes; one that shows the running balance answers the question he actually has.
 */
function Movements({ productId, unit }: { productId: string; unit: string }) {
  const { t, locale, qty, dateTime } = useI18n()
  const ledger = useQueryList(`ledger:${productId}`, () => listStockLedger(productId), {
    staleMs: 30_000,
  })

  return (
    <Section title={t('stock.ledger')}>
      <div className="card overflow-hidden">
        {ledger.loading && ledger.rows.length === 0 ? (
          <SkeletonRows rows={3} />
        ) : ledger.rows.length === 0 ? (
          <p className="text-ink-faint px-3.5 py-5 text-center text-sm">
            {t('stock.noMovements')}
          </p>
        ) : (
          ledger.rows.map((entry, index) => {
            const reason = STOCK_REASONS[entry.reason]
            const when = dateTime(entry.created_at)
            return (
              <div key={entry.id}>
                {index > 0 ? <Divider /> : null}
                <Row
                  title={locale === 'bn' ? reason.bn : reason.en}
                  subtitle={entry.note ? `${when} · ${entry.note}` : when}
                  trailing={<DeltaBadge delta={entry.delta} />}
                  trailingSub={qty(entry.balance_after, unit)}
                />
              </div>
            )
          })
        )}
      </div>
    </Section>
  )
}

/**
 * Adding a category without leaving the product.
 *
 * A shopkeeper entering his twentieth product discovers he wants a 'মসলা' group. Sending
 * him to a settings screen to make one would cost him the half-filled form, so the whole
 * thing is one field in a sheet.
 */
function NewCategorySheet({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    await onCreate(trimmed)
    setName('')
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('product.newCategory')}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          loading={busy}
          disabled={!name.trim()}
          onClick={() => void submit()}
        >
          {t('common.add')}
        </Button>
      }
    >
      <Field label={t('common.name')} required className="pb-2">
        {({ id }) => (
          <Input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        )}
      </Field>
    </Sheet>
  )
}
