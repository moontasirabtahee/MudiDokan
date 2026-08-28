import { useMemo, useRef, useState } from 'react'
import { Screen } from '@/components/layout/AppShell'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Input, SearchInput } from '@/components/ui/Field'
import { Badge, Divider, EmptyState, Row, SkeletonRows } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { AmountField, QtyField } from '@/components/ui/NumberField'
import { Sheet, useConfirm } from '@/components/ui/Sheet'
import { listProducts } from '@/data/products'
import { useQueryList } from '@/hooks/useQuery'
import { useWrite } from '@/hooks/useWrite'
import { useI18n } from '@/i18n/I18nProvider'
import { pickOnEnter, searchCatalog } from '@/lib/catalog'
import type { ProductStatus, SaleResult } from '@/lib/database.types'
import { cn, newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { BarcodeScannerModal } from '@/components/scanner/BarcodeScannerModal'
import { VoiceSearchModal } from '@/components/voice/VoiceSearchModal'
import { invalidateCacheKey, invalidateCachePrefix } from '@/offline/db'
import { sync } from '@/offline/sync'
import { PaySheet } from './PaySheet'
import { ReceiptSheet } from './ReceiptSheet'
import { type CartAction, type CartLine, cartTotals, lineTotal, toSalePayload } from './cart'
import { forgetStoredCart } from './cartStorage'
import { bumpFavourite, loadFavourites, saveFavourites, topFavourites } from './favourites'
import { type ReceiptData, receiptFromCart } from './receipt'
import { useCart } from './useCart'

/**
 * The sell screen. The reason this app exists.
 *
 * Everything about it is arranged around one number: the count of taps between a
 * customer putting something on the counter and the sale being recorded. For the
 * ordinary case — one of the six things this shop sells all day, paid in cash — that
 * number is three: the tile, "টাকা নিন", "বিক্রি শেষ করুন". Every other case degrades
 * from that one rather than switching to a different mode.
 *
 * ## What is on screen, in order
 *
 * Search first, because it is the universal path and has to be under the thumb before
 * anything else. Then either the results or the frequent-product tiles — they answer
 * the same question and only one of them can be relevant, so they share the space.
 * Then the cart, growing downward. The total and the payment button are pinned to the
 * bottom and always visible, because the total is what the shopkeeper reads aloud
 * while he works.
 *
 * ## The cart is not lost by leaving
 *
 * `useCart` persists to the device, so checking a price mid-sale — or the browser
 * killing a backgrounded tab — does not throw away a half-built basket. See that file
 * for why the restore window is deliberately short.
 *
 * ## One idempotency key per sale, not per tap
 *
 * `attemptId` is minted on the first attempt to complete and held until one succeeds.
 * That is what makes a double-tapped button, or a retry after a timeout nobody heard
 * back from, produce one sale rather than two: the RPC recognises the key and returns
 * the sale it already made. It is cleared on success, so the next customer gets a new
 * one and does not dedupe against the last.
 */
export default function Sell() {
  const { t, money, qty: fmtQty } = useI18n()
  const { shopId, shop, shopName, can } = useShop()
  const [confirm, confirmElement] = useConfirm()

  const [cart, dispatch] = useCart(shopId)
  const totals = cartTotals(cart)

  const [query, setQuery] = useState('')
  const [paying, setPaying] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [receipt, setReceipt] = useState<{ data: ReceiptData; queued: boolean } | null>(null)

  const attemptId = useRef<string | null>(null)
  const [favourites, setFavourites] = useState(() => (shopId ? loadFavourites(shopId) : {}))

  const sale = useWrite<'create_sale', SaleResult>('create_sale', {
    // The receipt sheet is the confirmation, for both outcomes. A toast on top of it
    // would be the same news twice.
    success: null,
    queued: null,
  })

  const catalog = useQueryList('products:catalog', listProducts, {
    staleMs: 5 * 60_000,
    onSync: true,
  })

  const results = useMemo(() => searchCatalog(catalog.rows, query), [catalog.rows, query])

  const tiles = useMemo(() => {
    const byId = new Map(catalog.rows.map((row) => [row.id, row]))
    // A favourite whose product has been retired simply stops appearing; its count
    // stays and decays away on its own.
    return topFavourites(favourites)
      .map((id) => byId.get(id))
      .filter((row): row is ProductStatus => Boolean(row))
  }, [favourites, catalog.rows])

  const editing = cart.lines.find((line) => line.key === editingKey) ?? null

  function add(product: ProductStatus, qty = 1) {
    dispatch({ type: 'add', product, qty })
    // Clearing the query puts the cart back on screen, which is where the eye needs
    // to be to confirm what was just added.
    setQuery('')
    if (shopId) {
      const next = bumpFavourite(favourites, product.id)
      setFavourites(next)
      saveFavourites(shopId, next)
    }
  }

  async function clearCart() {
    const ok = await confirm({
      title: t('sell.clearCart'),
      body: t('sell.clearCartWarn'),
      confirmLabel: t('sell.clearCart'),
      danger: true,
    })
    if (!ok) return
    dispatch({ type: 'clear' })
    forgetStoredCart()
  }

  async function complete() {
    if (!shopId || !shop) return
    attemptId.current ??= newId()
    const soldAt = new Date().toISOString()

    const outcome = await sale.write({
      args: { payload: toSalePayload(cart, shopId, attemptId.current, soldAt) },
      amount: totals.total,
    })
    if (!outcome.ok) return

    // Built from the cart rather than the response, so a queued sale and a confirmed
    // one produce the same receipt. The differences are the two things only the server
    // knows: the invoice number and the customer's resulting balance.
    const data = receiptFromCart(cart, shop, shopName, {
      invoiceNo: outcome.result?.sale.invoice_no ?? null,
      customerName: outcome.result?.customer?.name ?? null,
      balanceAfter: outcome.result?.customer?.due_balance ?? null,
      soldAt,
      totals,
    })

    attemptId.current = null
    setReceipt({ data, queued: outcome.queued })
    setPaying(false)
    dispatch({ type: 'clear' })
    forgetStoredCart()
    // Stock is now wrong by exactly what was just sold.
    void catalog.refetch()

    // Invalidate khata, dashboard, and customer caches so they reflect the new sale immediately
    void invalidateCacheKey(shopId, 'party:customers')
    void invalidateCacheKey(shopId, 'dashboard:today')
    void invalidateCacheKey(shopId, 'sales:recent')
    void invalidateCachePrefix(shopId, 'party:')
    void sync.refresh()
  }

  const searching = query.trim().length > 0

  const [barcodeOpen, setBarcodeOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)

  function handleBarcodeScanned(code: string) {
    const target = code.trim().toLowerCase()
    const found = catalog.rows.find(
      (p) =>
        p.barcode?.toLowerCase() === target ||
        p.sku?.toLowerCase() === target ||
        p.barcode === code.trim() ||
        p.sku === code.trim(),
    )
    if (found) {
      add(found)
    } else {
      setQuery(code)
    }
  }

  function handleVoiceProductSelected(product: ProductStatus, quantity: number) {
    add(product, quantity > 0 ? quantity : 1)
  }

  function handleVoiceMultipleSelected(items: Array<{ product: ProductStatus; quantity: number }>) {
    for (const item of items) {
      add(item.product, item.quantity > 0 ? item.quantity : 1)
    }
  }

  return (
    <Screen
      title={t('sell.title')}
      actions={
        cart.lines.length > 0 ? (
          <IconButton
            name="trash"
            label={t('sell.clearCart')}
            onClick={() => void clearCart()}
          />
        ) : undefined
      }
      footer={
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <p className="text-ink-faint text-xs">{t('sell.payable')}</p>
            <p className="tnum text-ink text-xl font-bold leading-tight">{money(totals.total)}</p>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={totals.lineCount === 0}
            iconAfter="right"
            onClick={() => setPaying(true)}
          >
            {t('sell.next')}
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={() => {
              const found = pickOnEnter(catalog.rows, query)
              if (found) add(found)
            }}
            placeholder={t('sell.searchProduct')}
          />
        </div>
        <button
          type="button"
          onClick={() => setBarcodeOpen(true)}
          title="ক্যামেরা বারকোড স্ক্যানার"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-rule bg-surface text-brand hover:bg-brand-soft shadow-sm transition-all"
        >
          <Icon name="barcode" size={20} />
        </button>
        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          title="মুখে বলে পণ্য খুঁজুন"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-rule bg-surface text-brand hover:bg-brand-soft shadow-sm transition-all"
        >
          <Icon name="mic" size={20} />
        </button>
      </div>

      {/* ── Quick Action Helpers ────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={() => setBarcodeOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-surface border border-rule text-xs font-semibold text-ink-soft hover:bg-brand-soft hover:text-brand hover:border-brand/30 transition-all shadow-2xs"
        >
          <Icon name="barcode" size={15} className="text-brand" />
          <span>বারকোড স্ক্যান</span>
        </button>
        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-surface border border-rule text-xs font-semibold text-ink-soft hover:bg-brand-soft hover:text-brand hover:border-brand/30 transition-all shadow-2xs"
        >
          <Icon name="mic" size={15} className="text-brand" />
          <span>মুখে বলুন</span>
        </button>
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-surface border border-rule text-xs font-semibold text-ink-soft hover:bg-brand-soft hover:text-brand hover:border-brand/30 transition-all shadow-2xs"
        >
          <Icon name="plus" size={15} className="text-brand" />
          <span>নতুন আইটেম</span>
        </button>
      </div>

      <BarcodeScannerModal
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        onScan={handleBarcodeScanned}
        title="পণ্য স্ক্যান করে যোগ করুন"
      />

      <VoiceSearchModal
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        products={catalog.rows}
        onSelectProduct={(p, q) => handleVoiceProductSelected(p, q)}
        onAddMultiple={handleVoiceMultipleSelected}
        onSetSearch={(q) => setQuery(q)}
      />

      {/* ── Results, or the frequent products ───────────────────────────── */}
      {searching ? (
        catalog.loading ? (
          <SkeletonRows rows={4} className="mt-2" />
        ) : results.length === 0 ? (
          <div className="card mt-2 px-3.5 py-4">
            <p className="text-ink-soft text-sm">{t('product.emptySearch', { query })}</p>
            <Button
              size="sm"
              icon="plus"
              className="mt-2.5"
              onClick={() => setCustomOpen(true)}
            >
              {t('sell.customItem')}
            </Button>
          </div>
        ) : (
          <div className="card mt-2 overflow-hidden">
            {results.map((product, index) => (
              <div key={product.id}>
                {index > 0 ? <Divider /> : null}
                <Row
                  onClick={() => add(product)}
                  title={product.name_bn || product.name}
                  subtitle={
                    product.stock > 0 ? fmtQty(product.stock, product.unit) : t('stock.outOfStock')
                  }
                  trailing={money(product.sell_price)}
                />
              </div>
            ))}
          </div>
        )
      ) : tiles.length > 0 ? (
        <div className="mt-3">
          <p className="text-ink-faint mb-1.5 px-1 text-xs">{t('sell.quickAdd')}</p>
          <div className="grid grid-cols-3 gap-2">
            {tiles.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => add(product)}
                className={cn(
                  'bg-surface shadow-card active:bg-brand-soft flex min-h-tapxl flex-col',
                  'justify-between rounded-card p-2.5 text-start',
                )}
              >
                <span className="text-ink line-clamp-2 text-sm font-medium leading-tight">
                  {product.name_bn || product.name}
                </span>
                <span className="tnum text-brand-deep mt-1 text-sm font-semibold">
                  {money(product.sell_price)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── The cart ────────────────────────────────────────────────────── */}
      {cart.lines.length > 0 ? (
        <>
          <div className="card divide-rule mt-3 divide-y">
            {cart.lines.map((line) => (
              <CartRow
                key={line.key}
                line={line}
                dispatch={dispatch}
                onEdit={() => setEditingKey(line.key)}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" icon="plus" onClick={() => setCustomOpen(true)}>
              {t('sell.customItem')}
            </Button>
            {/* Profit is the owner's business and not the counter staff's, and it is
                only shown when every line has a cost — a guess is worse than
                silence. */}
            {can('manager') && !totals.costPartial ? (
              <span className="text-ink-faint tnum text-xs">
                {t('report.grossProfit')} {money(totals.profit)}
              </span>
            ) : null}
          </div>
        </>
      ) : searching ? null : (
        <EmptyState
          className="mt-4"
          icon="cart"
          title={t('sell.emptyCart')}
          body={t('sell.emptyCartHelp')}
          action={{ label: t('sell.customItem'), onClick: () => setCustomOpen(true) }}
        />
      )}

      {/* ── Sheets ──────────────────────────────────────────────────────── */}
      <PaySheet
        open={paying}
        onClose={() => setPaying(false)}
        cart={cart}
        totals={totals}
        dispatch={dispatch}
        onComplete={() => void complete()}
        busy={sale.busy}
      />

      <LineSheet
        line={editing}
        onClose={() => setEditingKey(null)}
        dispatch={dispatch}
        showCost={can('manager')}
      />

      {/* Keyed on `open` so each visit starts empty. A sheet that remembers the last
          loose item is a sheet that adds it twice. */}
      <CustomLineSheet
        key={customOpen ? 'custom-open' : 'custom-closed'}
        open={customOpen}
        initialName={query}
        onClose={() => setCustomOpen(false)}
        onAdd={(name, unitPrice, quantity) => {
          dispatch({ type: 'addCustom', name, unitPrice, qty: quantity })
          setCustomOpen(false)
          setQuery('')
        }}
      />

      <ReceiptSheet
        open={Boolean(receipt)}
        data={receipt?.data ?? null}
        queued={receipt?.queued ?? false}
        onClose={() => setReceipt(null)}
        onNext={() => setReceipt(null)}
      />

      {confirmElement}
    </Screen>
  )
}

/* ── One line in the cart ───────────────────────────────────────────────────── */

/**
 * Quantity is editable in place; everything else is one tap away.
 *
 * Quantity is what changes on most lines — two of these, one and a half kilos of
 * that — so it gets the steppers and the keypad right there in the row. Price and
 * per-line discount are rarer and riskier, so they live behind a tap on the name.
 * That split keeps the row readable on a 5-inch screen, and means a thumb resting on
 * the list while scrolling cannot silently change a price.
 */
function CartRow({
  line,
  dispatch,
  onEdit,
}: {
  line: CartLine
  dispatch: (action: CartAction) => void
  onEdit: () => void
}) {
  const { t, money, unit: unitLabel } = useI18n()
  // Advisory, never blocking: the shopkeeper can see the shelf and the app cannot.
  const short = line.stock !== null && line.qty > line.stock

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-start">
          <span className="text-ink block truncate text-base font-medium">{line.name}</span>
          <span className="text-ink-faint tnum text-xs">
            {money(line.unit_price)} / {unitLabel(line.unit)}
            {line.line_discount > 0 ? ` · −${money(line.line_discount)}` : ''}
          </span>
        </button>
        <span className="tnum text-ink shrink-0 pt-0.5 text-end font-semibold">
          {money(lineTotal(line))}
        </span>
        <button
          type="button"
          onClick={() => dispatch({ type: 'remove', key: line.key })}
          aria-label={t('common.delete')}
          className="text-ink-faint -me-1 flex h-9 w-9 shrink-0 items-center justify-center"
        >
          <Icon name="close" size="sm" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <QtyField
          value={line.qty}
          onChange={(next) => dispatch({ type: 'qty', key: line.key, qty: next })}
          unit={line.unit}
          weighted={line.weighted}
          className="max-w-[13rem] flex-1"
        />
        {short ? (
          <Badge tone="warn" icon="alert">
            {t('sell.stockShort', { stock: line.stock ?? 0 })}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

/* ── Editing a line ─────────────────────────────────────────────────────────── */

function LineSheet({
  line,
  onClose,
  dispatch,
  showCost,
}: {
  line: CartLine | null
  onClose: () => void
  dispatch: (action: CartAction) => void
  showCost: boolean
}) {
  const { t, money } = useI18n()
  const belowCost = Boolean(
    showCost && line && line.buy_price !== null && line.unit_price < line.buy_price,
  )

  return (
    <Sheet
      open={Boolean(line)}
      onClose={onClose}
      title={line?.name}
      footer={
        <div className="flex gap-3">
          <Button
            size="lg"
            variant="ghost"
            icon="trash"
            onClick={() => {
              if (line) dispatch({ type: 'remove', key: line.key })
              onClose()
            }}
          >
            {t('common.delete')}
          </Button>
          <Button variant="primary" size="lg" block onClick={onClose}>
            {t('common.done')}
          </Button>
        </div>
      }
    >
      {line ? (
        <div className="space-y-4 pb-2">
          <Field
            label={t('common.price')}
            hint={
              showCost && line.buy_price !== null
                ? `${t('product.buyPrice')} ${money(line.buy_price)}`
                : undefined
            }
          >
            {({ id, describedBy }) => (
              <AmountField
                id={id}
                aria-describedby={describedBy}
                value={line.unit_price}
                onChange={(next) => dispatch({ type: 'price', key: line.key, unitPrice: next })}
                emphasis
              />
            )}
          </Field>

          {/* Below cost is a warning and never a refusal — clearing stock before it
              spoils is a real decision — so it sits outside the field rather than
              putting it in an error state. */}
          {belowCost ? (
            <p className="text-ink bg-warn-soft ring-warn/40 flex items-center gap-2 rounded-card px-3 py-2 text-sm ring-1">
              <Icon name="alert" size="sm" />
              {t('product.priceBelowCost')}
            </p>
          ) : null}

          <Field label={t('common.discount')} optional>
            {({ id, describedBy }) => (
              <AmountField
                id={id}
                aria-describedby={describedBy}
                value={line.line_discount}
                onChange={(next) => dispatch({ type: 'lineDiscount', key: line.key, amount: next })}
              />
            )}
          </Field>

          <div className="bg-paper flex items-baseline justify-between rounded-card px-3.5 py-2.5">
            <span className="text-ink-soft text-sm">{t('common.total')}</span>
            <span className="tnum text-ink text-xl font-bold">{money(lineTotal(line))}</span>
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}

/* ── A line that is not in the catalogue ────────────────────────────────────── */

/**
 * Loose goods, and the reason this app does not get abandoned.
 *
 * Every real grocery sells things the catalogue does not have: half a kilo out of an
 * open sack, a single cigarette, a bag of something a supplier left behind. A POS
 * that insists these be created as products first is a POS that gets closed and
 * replaced with a calculator — and once that happens for one item it happens for all
 * of them. So a custom line is first class. It simply carries no cost price, which
 * the profit report knows to exclude rather than guess at.
 */
function CustomLineSheet({
  open,
  initialName,
  onClose,
  onAdd,
}: {
  open: boolean
  initialName: string
  onClose: () => void
  onAdd: (name: string, unitPrice: number, qty: number) => void
}) {
  const { t } = useI18n()
  // Seeded from whatever was typed into the search box: someone who searched for it,
  // failed to find it, and tapped this has already told us the name once.
  const [name, setName] = useState(initialName)
  const [price, setPrice] = useState<number | null>(null)
  const [quantity, setQuantity] = useState<number | null>(1)

  const ready = name.trim().length > 0 && (price ?? 0) > 0 && (quantity ?? 0) > 0

  function submit() {
    if (!ready) return
    onAdd(name.trim(), price ?? 0, quantity ?? 1)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('sell.customItem')}
      footer={
        <Button variant="primary" size="lg" block disabled={!ready} icon="plus" onClick={submit}>
          {t('common.add')}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t('sell.customItemName')} required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus={!initialName}
            />
          )}
        </Field>

        <Field label={t('common.price')} required>
          {({ id, describedBy }) => (
            <AmountField
              id={id}
              aria-describedby={describedBy}
              value={price}
              onChange={setPrice}
              onSubmit={submit}
              autoFocus={Boolean(initialName)}
              emphasis
            />
          )}
        </Field>

        <Field label={t('common.qty')}>
          {({ id }) => <QtyField id={id} value={quantity} onChange={setQuantity} />}
        </Field>
      </div>
    </Sheet>
  )
}
