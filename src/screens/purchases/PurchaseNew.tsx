import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { PartyPicker } from '@/components/PartyPicker'
import { Button } from '@/components/ui/Button'
import { EmptyState, Row } from '@/components/ui/Feedback'
import { Field, Input, SearchInput } from '@/components/ui/Field'
import { AmountField, QtyField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { listProducts } from '@/data/products'
import { useQueryList } from '@/hooks/useQuery'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { searchCatalog } from '@/lib/catalog'
import { ROUTES, detailPath } from '@/lib/constants'
import type { CreatePurchasePayload, ProductStatus, PurchaseItemInput, PurchaseResult } from '@/lib/database.types'
import { newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'

interface PurchaseLine {
  product: ProductStatus
  qty: number
  unitCost: number
}

export default function PurchaseNew() {
  const { t, money, qty: fmtQty } = useI18n()
  const { shopId } = useShop()
  const navigate = useNavigate()

  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [supplierName, setSupplierName] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [productQuery, setProductQuery] = useState('')

  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [paid, setPaid] = useState<number | null>(null)
  const [supplierRef, setSupplierRef] = useState('')
  const [note, setNote] = useState('')

  const catalog = useQueryList('products:catalog', listProducts, { staleMs: 5 * 60_000, onSync: true })
  const searchResults = useMemo(() => searchCatalog(catalog.rows, productQuery), [catalog.rows, productQuery])

  const purchaseWrite = useWrite<'create_purchase', PurchaseResult>('create_purchase', {
    success: 'purchase.done',
  })

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + Math.round(l.qty * l.unitCost * 100) / 100, 0),
    [lines],
  )

  const remaining = subtotal - (paid ?? subtotal)

  function addProduct(p: ProductStatus) {
    setLines((prev) => {
      const exists = prev.find((l) => l.product.id === p.id)
      if (exists) {
        return prev.map((l) =>
          l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l,
        )
      }
      return [...prev, { product: p, qty: 1, unitCost: p.buy_price || p.sell_price }]
    })
    setProductPickerOpen(false)
    setProductQuery('')
  }

  function updateLine(productId: string, patch: Partial<PurchaseLine>) {
    setLines((prev) =>
      prev.map((l) => (l.product.id === productId ? { ...l, ...patch } : l)),
    )
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product.id !== productId))
  }

  async function handleSave() {
    if (!shopId || lines.length === 0) return

    const items: PurchaseItemInput[] = lines.map((l) => ({
      product_id: l.product.id,
      qty: l.qty,
      unit: l.product.unit,
      unit_cost: l.unitCost,
    }))

    const payload: CreatePurchasePayload = {
      shop_id: shopId,
      client_uuid: newId(),
      supplier_id: supplierId,
      supplier_ref: supplierRef.trim() || null,
      items,
      paid: paid != null ? paid : subtotal,
      note: note.trim() || null,
    }

    const outcome = await purchaseWrite.write({
      args: { payload },
      amount: subtotal,
      label: `${t('purchase.title')} — ${money(subtotal)}`,
    })

    if (outcome.ok) {
      if (outcome.result?.purchase.id) {
        navigate(detailPath('purchase', outcome.result.purchase.id))
      } else {
        navigate(ROUTES.purchases)
      }
    }
  }

  return (
    <Screen
      title={t('purchase.new')}
      back={() => navigate(ROUTES.purchases)}
      footer={
        <Button
          block
          size="lg"
          variant="primary"
          icon="check"
          loading={purchaseWrite.busy}
          disabled={lines.length === 0}
          onClick={() => void handleSave()}
        >
          {t('purchase.complete')} ({money(subtotal)})
        </Button>
      }
    >
      {/* Supplier Selector */}
      <div className="card p-3 mb-3">
        <Row
          title={t('purchase.supplier')}
          subtitle={supplierName || t('common.optional')}
          trailing={
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              {supplierName ? t('common.edit') : t('common.add')}
            </Button>
          }
        />
      </div>

      {/* Items list */}
      <div className="card p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-sm text-ink">{t('nav.products')}</span>
          <Button
            size="sm"
            variant="outline"
            icon="plus"
            onClick={() => setProductPickerOpen(true)}
          >
            {t('common.add')}
          </Button>
        </div>

        {lines.length === 0 ? (
          <EmptyState
            icon="box"
            title={t('sell.emptyCart')}
            body={t('sell.emptyCartHelp')}
            action={{
              label: t('common.add'),
              onClick: () => setProductPickerOpen(true),
              icon: 'plus',
            }}
          />
        ) : (
          <ul className="divide-y divide-rule/60">
            {lines.map((l) => (
              <li key={l.product.id} className="py-2.5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="font-semibold text-sm text-ink">
                    {l.product.name_bn || l.product.name}
                  </span>
                  <span className="tnum font-bold text-sm text-ink">
                    {money(Math.round(l.qty * l.unitCost * 100) / 100)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-ink-faint mb-1 block">{t('common.qty')}</label>
                    <QtyField
                      value={l.qty}
                      unit={l.product.unit}
                      weighted={l.product.is_weighted}
                      onChange={(q) => updateLine(l.product.id, { qty: q ?? 1 })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-faint mb-1 block">{t('purchase.unitCost')}</label>
                    <AmountField
                      value={l.unitCost}
                      onChange={(c) => updateLine(l.product.id, { unitCost: c ?? 0 })}
                    />
                  </div>
                </div>

                <div className="mt-1 text-right">
                  <button
                    type="button"
                    onClick={() => removeLine(l.product.id)}
                    className="text-xs text-warn hover:underline"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Payment and Reference */}
      {lines.length > 0 ? (
        <div className="card p-3 mb-3 space-y-3">
          <Field label={t('purchase.payNow')} hint={`${t('purchase.remaining')}: ${money(Math.max(0, remaining))}`}>
            {({ id: payId, describedBy, invalid }) => (
              <AmountField
                id={payId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={paid ?? subtotal}
                onChange={setPaid}
              />
            )}
          </Field>

          <Field label={t('purchase.ref')} optional>
            {({ id: refId, describedBy, invalid }) => (
              <Input
                id={refId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={supplierRef}
                onChange={(e) => setSupplierRef(e.target.value)}
                placeholder={t('purchase.ref')}
              />
            )}
          </Field>

          <Field label={t('common.note')} optional>
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
        </div>
      ) : null}

      {/* Supplier Picker */}
      <PartyPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        party="supplier"
        onPick={(id, name) => {
          setSupplierId(id)
          setSupplierName(name)
        }}
      />

      {/* Product Picker Sheet */}
      <Sheet
        open={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        title={t('product.title')}
      >
        <SearchInput
          value={productQuery}
          onChange={setProductQuery}
          placeholder={t('common.searchPlaceholder')}
          autoFocus
        />

        <ul className="mt-3 divide-y divide-rule/60 max-h-[60vh] overflow-y-auto">
          {searchResults.map((p) => (
            <li
              key={p.id}
              onClick={() => addProduct(p)}
              className="p-3 flex items-center justify-between hover:bg-canvas/60 cursor-pointer"
            >
              <div>
                <p className="font-semibold text-sm text-ink">{p.name_bn || p.name}</p>
                <p className="text-xs text-ink-faint">
                  {t('product.buyPrice')}: {money(p.buy_price)} • {t('product.stock')}: {fmtQty(p.stock, p.unit)}
                </p>
              </div>
              <Button size="sm" variant="ghost">
                +
              </Button>
            </li>
          ))}
        </ul>
      </Sheet>
    </Screen>
  )
}
