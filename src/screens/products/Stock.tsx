import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Badge, Divider, EmptyState, ErrorState, Row, SkeletonRows } from '@/components/ui/Feedback'
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented'
import { listExpiring, listLowStock } from '@/data/products'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { LIMITS, detailPath } from '@/lib/constants'
import type { ExpiringRow } from '@/lib/database.types'
import { shareText } from '@/lib/share'
import { cn } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import {
  buildReorder,
  expiringValue,
  expiryLabel,
  expiryTone,
  reorderText,
  sortExpiring,
} from './reorder'

type Tab = 'low' | 'expiring'

/**
 * The two lists that turn into actions.
 *
 * This screen is the one a shopkeeper opens *before* something goes wrong, which means
 * it has to be worth opening. So neither tab is a report: the first ends in a message
 * to the মহাজন, the second ends in a discount sticker or a bin. Every number on screen
 * is here because it changes one of those two decisions.
 *
 * ## Two queries rather than one filter
 *
 * Both views hang off `v_products_status` and both add a column of their own —
 * `suggested_order_qty` and `expiry_state`. Fetching the whole catalogue and
 * recomputing those here would give the app a second definition of how much to order,
 * and the one on the shopkeeper's screen would be the one that was wrong. Both lists
 * are short by construction, so two small requests cost less than one large one.
 *
 * ## Why a cashier sees the lists but not the money
 *
 * A cashier noticing the sugar has run out is useful, so the rows are not gated. What
 * the shop paid is a different matter — this screen can be open at the counter with a
 * customer leaning on it, which is the same reason the product list never shows cost.
 * So the totals appear for a manager and quietly do not for anyone else.
 */
export default function Stock() {
  const { t, locale, timeZone, money, num, qty, name, date, today } = useI18n()
  const { can, shopName } = useShop()
  const navigate = useNavigate()
  const toast = useToast()

  const [tab, setTab] = useState<Tab>('low')
  const [shown, setShown] = useState<number>(LIMITS.pageSize)
  const [sharing, setSharing] = useState(false)

  const lowStock = useQueryList('stock:low', listLowStock, { staleMs: 60_000, onSync: true })
  const expiring = useQueryList('stock:expiring', listExpiring, { staleMs: 300_000, onSync: true })

  const mayCost = can('manager')

  const plan = useMemo(() => buildReorder(lowStock.rows, locale), [lowStock.rows, locale])
  const dated = useMemo(() => sortExpiring(expiring.rows), [expiring.rows])
  const atRisk = useMemo(() => expiringValue(expiring.rows), [expiring.rows])

  const active = tab === 'low' ? lowStock : expiring
  const total = tab === 'low' ? plan.lines.length : dated.length
  const more = Math.max(0, total - shown)

  function pick(next: Tab) {
    setTab(next)
    setShown(LIMITS.pageSize)
  }

  /**
   * Hands the list to whatever the phone has, and says which of the two happened.
   *
   * Silence on a successful share is deliberate — the share sheet is its own
   * confirmation, and a toast arriving behind it lands on the wrong screen. A cancel is
   * silent for the same reason: the shopkeeper knows he cancelled.
   */
  async function share() {
    if (sharing || plan.lines.length === 0) return
    setSharing(true)
    try {
      const text = reorderText(plan, { shopName, on: today(), locale, timeZone })
      const result = await shareText(text, t('stock.reorderList'))
      if (result === 'copied') toast.say('common.copied')
      else if (result === 'failed') toast.say('error.generic', undefined, { kind: 'error' })
    } finally {
      setSharing(false)
    }
  }

  const tabs: SegmentedOption<Tab>[] = [
    {
      value: 'low',
      label: t('stock.lowStock'),
      badge: plan.lines.length > 0 ? num(plan.lines.length) : undefined,
    },
    {
      value: 'expiring',
      label: t('stock.expiring'),
      badge: dated.length > 0 ? num(dated.length) : undefined,
    },
  ]

  return (
    <Screen
      title={t('stock.title')}
      footer={
        tab === 'low' && plan.lines.length > 0 ? (
          <Button
            variant="primary"
            size="lg"
            block
            icon="share"
            loading={sharing}
            onClick={() => void share()}
          >
            {t('stock.shareReorder')}
          </Button>
        ) : undefined
      }
    >
      <Segmented value={tab} onChange={pick} options={tabs} label={t('common.filter')} className="mt-1" />

      {total > 0 ? (
        <Summary
          tone={tab === 'low' ? 'brand' : 'warn'}
          count={total}
          label={tab === 'low' ? t('stock.orderCost') : t('stock.atRisk')}
          value={mayCost ? money(tab === 'low' ? plan.cost : atRisk) : null}
        />
      ) : null}

      <div className="card mt-3 overflow-hidden">
        {active.loading && total === 0 ? (
          <SkeletonRows rows={5} />
        ) : active.error && total === 0 ? (
          <ErrorState onRetry={active.refetch} />
        ) : total === 0 ? (
          <EmptyState icon="check" title={t('stock.empty')} />
        ) : tab === 'low' ? (
          plan.lines.slice(0, shown).map((line, index) => (
            <div key={line.id}>
              {index > 0 ? <Divider /> : null}
              <Row
                onClick={() => navigate(detailPath('product', line.id))}
                title={line.name}
                subtitle={line.category ?? undefined}
                trailing={
                  // The tone is the whole message: amber means order it on the next
                  // van, red means the shelf is bare and a customer asked today.
                  <Badge tone={line.out ? 'danger' : 'brand'} icon="truck">
                    {qty(line.qty, line.unit)}
                  </Badge>
                }
                trailingSub={`${t('stock.current')} ${qty(line.stock, line.unit)}`}
                chevron
              />
            </div>
          ))
        ) : (
          dated.slice(0, shown).map((row, index) => (
            <div key={row.id}>
              {index > 0 ? <Divider /> : null}
              <Row
                onClick={() => navigate(detailPath('product', row.id))}
                title={name(row)}
                subtitle={date(row.expiry_date)}
                trailing={<ExpiryBadge row={row} />}
                trailingSub={qty(row.stock, row.unit)}
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
    </Screen>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────────── */

/**
 * What the whole list adds up to, above the list.
 *
 * The count alone would be a fact; the count with the money beside it is a decision —
 * ৳৫,৫৭০ is a van worth calling for, ৳২৭০ is not, and the shopkeeper can tell which
 * before scrolling anything. On the expiry tab the same figure is a loss rather than a
 * cost, which is why the two tabs are not the same colour.
 */
function Summary({
  tone,
  count,
  label,
  value,
}: {
  tone: 'brand' | 'warn'
  count: number
  label: string
  /** Null for a cashier. See the note on the screen. */
  value: string | null
}) {
  const { t } = useI18n()
  return (
    <div
      className={cn(
        'mt-3 flex items-baseline justify-between rounded-card px-3.5 py-3',
        tone === 'warn' ? 'bg-warn-soft' : 'bg-brand-soft',
      )}
    >
      <span className="text-ink text-sm font-medium">{t('product.count', { count })}</span>
      {value ? (
        <span className="text-end">
          <span className="text-ink-soft block text-xs">{label}</span>
          <span className="tnum text-ink text-lg font-semibold">{value}</span>
        </span>
      ) : null}
    </div>
  )
}

/** 'আজই শেষ', '৩ দিন বাকি', '২ দিন আগে শেষ' — coloured only when it has to be. */
function ExpiryBadge({ row }: { row: ExpiringRow }) {
  const { locale } = useI18n()
  return (
    <Badge tone={expiryTone(row.expiry_state)} icon="clock">
      {expiryLabel(row.days_to_expiry, locale)}
    </Badge>
  )
}
