import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button, Fab } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Field'
import { Badge, Divider, EmptyState, ErrorState, Row, SkeletonRows } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import { listAllProducts } from '@/data/products'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { type CatalogTab, browseCatalog, catalogCounts, stockState } from '@/lib/catalog'
import { LIMITS, ROUTES, detailPath } from '@/lib/constants'
import type { ProductStatus } from '@/lib/database.types'
import { useShop } from '@/providers/ShopProvider'
import { VoiceProductCreateModal } from '@/components/voice/VoiceProductCreateModal'

/**
 * The product list — the shop's shelves, as a page.
 *
 * Two jobs, and they pull in opposite directions. Most visits are "what do I have to
 * order", which is a filtered list read top to bottom. A few are "where is that one
 * product", which is a search box. So both are on screen at once and neither is behind
 * a menu: tabs across the top with live counts, search below them.
 *
 * The counts are the part that earns its place. A tab reading 'কম আছে ৭' tells the
 * shopkeeper there is something to do before he taps anything, which is the whole
 * difference between an app he opens and one he remembers to open.
 */
export default function Products() {
  const { t, money, num, qty, name } = useI18n()
  const { can } = useShop()
  const navigate = useNavigate()

  const [tab, setTab] = useState<CatalogTab>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState<number>(LIMITS.pageSize)
  const [voiceAddOpen, setVoiceAddOpen] = useState(false)

  // The retired products are fetched too, because the 'inactive' tab is where a
  // shopkeeper goes to bring one back — usually the morning after retiring it by
  // mistake.
  const catalog = useQueryList('products:all', listAllProducts, { staleMs: 60_000, onSync: true })

  const counts = useMemo(() => catalogCounts(catalog.rows), [catalog.rows])
  const rows = useMemo(() => browseCatalog(catalog.rows, tab, query), [catalog.rows, tab, query])

  /**
   * Rendering a thousand rows on a ৳৮,০০০ handset costs about a second of frozen
   * scroll, and nobody reads past the first screen anyway. Forty at a time, with a
   * button — not infinite scroll, which on a list this shape means never reaching the
   * bottom.
   */
  const visible = rows.slice(0, shown)
  const more = rows.length - visible.length

  function pick(next: CatalogTab) {
    setTab(next)
    setShown(LIMITS.pageSize)
  }

  function search(next: string) {
    setQuery(next)
    setShown(LIMITS.pageSize)
  }

  const tabs: SegmentedOption<CatalogTab>[] = [
    { value: 'all', label: t('common.all'), badge: counts.all > 0 ? num(counts.all) : undefined },
    {
      value: 'low',
      label: t('stock.lowStock'),
      badge: counts.low > 0 ? num(counts.low) : undefined,
    },
    {
      value: 'expiring',
      label: t('stock.expiring'),
      badge: counts.expiring > 0 ? num(counts.expiring) : undefined,
    },
    { value: 'inactive', label: t('product.inactive') },
  ]

  return (
    <Screen title={t('product.title')}>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 min-w-0">
          <SearchInput
            value={query}
            onChange={search}
            placeholder={t('common.searchPlaceholder')}
          />
        </div>
        {can('manager') && (
          <button
            type="button"
            onClick={() => setVoiceAddOpen(true)}
            title="মুখে বলে দ্রুত পণ্য যোগ করুন"
            className="flex h-11 items-center gap-1.5 px-3 rounded-card border border-brand/30 bg-brand-soft text-brand-deep hover:bg-brand/15 text-xs font-bold transition-all shrink-0 shadow-2xs"
          >
            <Icon name="mic" size={17} className="text-brand" />
            <span>মুখে বলে যোগ</span>
          </button>
        )}
      </div>

      <VoiceProductCreateModal
        open={voiceAddOpen}
        onClose={() => setVoiceAddOpen(false)}
        onCreated={() => void catalog.refetch()}
      />

      <Segmented
        value={tab}
        onChange={pick}
        options={tabs}
        label={t('common.filter')}
        size="sm"
        className="mt-3"
      />

      {can('manager') && counts.low > 0 && tab === 'low' && (
        <div className="mt-2.5 p-3 rounded-card bg-brand-soft border border-brand/20 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <Icon name="truck" size="sm" className="text-brand shrink-0" />
            <div>
              <p className="text-xs font-bold text-ink">মহাজন থেকে মাল তুলবেন?</p>
              <p className="text-[11px] text-ink-soft">কম থাকা পণ্যের জন্য চালান লিখুন — স্টক বাড়বে</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate('/purchases/new')}
          >
            চালান লিখুন
          </Button>
        </div>
      )}

      <p className="text-ink-faint mt-3 px-1 text-xs">
        {t('product.count', { count: rows.length })}
      </p>

      <div className="card mt-1.5 overflow-hidden">
        {catalog.loading && catalog.rows.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : catalog.error && catalog.rows.length === 0 ? (
          <ErrorState onRetry={catalog.refetch} />
        ) : visible.length === 0 ? (
          <ListEmpty
            query={query}
            tab={tab}
            canAdd={can('manager')}
            onAdd={() => navigate(ROUTES.productNew)}
          />
        ) : (
          visible.map((product, index) => (
            <div key={product.id}>
              {index > 0 ? <Divider /> : null}
              <Row
                onClick={() => navigate(detailPath('product', product.id))}
                title={name(product)}
                subtitle={subtitleFor(product, qty)}
                trailing={money(product.sell_price)}
                trailingSub={<StockTag product={product} />}
                chevron
              />
            </div>
          ))
        )}
      </div>

      {more > 0 ? (
        <Button variant="ghost" block className="mt-3" onClick={() => setShown(shown + LIMITS.pageSize)}>
          {t('common.showMore')} ({num(more)})
        </Button>
      ) : null}

      {/* Above the nav bar rather than in the header, because on this screen adding a
          product is the only thing anyone comes here to *do* — everything else is
          reading. A cashier does not get the button; the RPC would refuse him anyway,
          and a button that refuses is worse than no button. */}
      {can('manager') ? (
        <Fab name="plus" label={t('product.add')} onClick={() => navigate(ROUTES.productNew)} />
      ) : null}
    </Screen>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────────── */

/**
 * What is on the shelf, coloured only when it needs attention.
 *
 * A healthy stock number is plain text. Badging all of them would make the list a
 * field of green pills with nothing standing out, which is the same as badging none.
 */
function StockTag({ product }: { product: ProductStatus }) {
  const { t, qty } = useI18n()
  const state = stockState(product)

  if (state === 'out') {
    return <Badge tone="danger">{t('stock.outOfStock')}</Badge>
  }
  if (state === 'low') {
    return <Badge tone="warn">{qty(product.stock, product.unit)}</Badge>
  }
  return <>{qty(product.stock, product.unit)}</>
}

/**
 * The line under the name: category, and the selling unit when it is a weighed one.
 *
 * Cost price never appears in this list. A cashier scrolling the catalogue at the
 * counter is often standing next to a customer, and what the shop paid for a packet is
 * not a number to have on screen in front of the person buying it.
 */
function subtitleFor(
  product: ProductStatus,
  qty: (value: number | null | undefined, unit?: string | null) => string,
): string | undefined {
  const parts: string[] = []
  if (product.category_name) parts.push(product.category_name)
  if (product.is_weighted) parts.push(qty(1, product.unit))
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * Empty is four different situations, and telling them apart is most of the value.
 *
 * A search with no hits offers to create what was typed — the fastest path from "I
 * don't have this" to "I do", and the one moment a shopkeeper is definitely willing to
 * fill in a form. An empty 'low' tab is good news and says so.
 */
function ListEmpty({
  query,
  tab,
  canAdd,
  onAdd,
}: {
  query: string
  tab: CatalogTab
  canAdd: boolean
  onAdd: () => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const trimmed = query.trim()

  if (trimmed) {
    return (
      <EmptyState
        icon="search"
        title={t('product.emptySearch', { query: trimmed })}
        action={
          canAdd
            ? {
                label: t('product.addFromSearch', { query: trimmed }),
                onClick: () => navigate(`${ROUTES.productNew}?name=${encodeURIComponent(trimmed)}`),
                icon: 'plus',
              }
            : undefined
        }
      />
    )
  }

  if (tab === 'low' || tab === 'expiring') {
    return <EmptyState icon="check" title={t('stock.empty')} />
  }

  if (tab === 'inactive') {
    return <EmptyState icon="box" title={t('common.none')} />
  }

  return (
    <EmptyState
      icon="box"
      title={t('product.empty')}
      action={canAdd ? { label: t('product.emptyCta'), onClick: onAdd, icon: 'plus' } : undefined}
    />
  )
}
