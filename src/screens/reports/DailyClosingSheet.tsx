import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { AmountField } from '@/components/ui/NumberField'
import { Sheet } from '@/components/ui/Sheet'
import { getDailyClosing } from '@/data/reports'
import { useQuery } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import type { DailyClosing } from '@/lib/database.types'
import { shareText } from '@/lib/share'
import { cn } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'

interface DailyClosingSheetProps {
  open: boolean
  onClose: () => void
}

const NOTE_VALUES = [1000, 500, 200, 100, 50, 20, 10] as const

export function DailyClosingSheet({ open, onClose }: DailyClosingSheetProps) {
  const { money, today } = useI18n()
  const { shopId, shopName } = useShop()
  const currentDay = today()

  const [noteCounts, setNoteCounts] = useState<Record<number, number>>({
    1000: 0,
    500: 0,
    200: 0,
    100: 0,
    50: 0,
    20: 0,
    10: 0,
  })
  const [manualCount, setManualCount] = useState<number | null>(null)
  const [showDenominations, setShowDenominations] = useState(false)

  // Computed total from counted notes
  const denominationTotal = Object.entries(noteCounts).reduce(
    (sum, [val, count]) => sum + Number(val) * (count || 0),
    0,
  )

  const effectiveCountedCash = showDenominations
    ? (denominationTotal > 0 ? denominationTotal : null)
    : manualCount

  const closingQuery = useQuery<DailyClosing | null>(
    open && shopId ? `closing:${shopId}:${currentDay}:${effectiveCountedCash}` : null,
    () => (shopId ? getDailyClosing(shopId, currentDay, effectiveCountedCash) : Promise.resolve(null)),
    { staleMs: 5000 },
  )

  const c = closingQuery.data

  function updateNote(val: number, delta: number) {
    setNoteCounts((prev) => ({
      ...prev,
      [val]: Math.max(0, (prev[val] || 0) + delta),
    }))
  }

  function handleShareSummary() {
    if (!c) return
    const text = [
      `🌙 *${shopName} — দিনের সমাপনী হিসাব*`,
      `তারিখ: ${currentDay}`,
      `--------------------------`,
      `• নগদ বিক্রি: ${money(c.cash_from_sales)}`,
      `• বকেয়া আদায় (নগদ): ${money(c.dues_collected_cash)}`,
      `• নগদ খরচ: -${money(c.expenses)}`,
      `--------------------------`,
      `*ক্যাশ বাক্সে থাকার কথা:* ${money(c.expected_cash)}`,
      c.counted_cash !== null ? `*হাতে গোনা ক্যাশ:* ${money(c.counted_cash)}` : '',
      c.variance !== null
        ? c.variance === 0
          ? `*ফলাফল:* ✅ হিসাব সম্পূর্ণ মিলেছে!`
          : c.variance > 0
            ? `*ফলাফল:* 🟢 ৳${c.variance} উদ্বৃত্ত (Extra)`
            : `*ফলাফল:* 🔴 ৳${Math.abs(c.variance)} ঘাটতি (Short)`
        : '',
      `--------------------------`,
      `মুদি দোকান অ্যাপ`,
    ]
      .filter(Boolean)
      .join('\n')

    void shareText(text, `${shopName} দিনের হিসাব`)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="দিনের সমাপনী হিসাব (Daily Closing)"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block icon="share" onClick={handleShareSummary}>
            হিসাব পাঠান
          </Button>
          <Button variant="primary" block onClick={onClose}>
            সম্পন্ন
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        {/* ── System Expected Cash ───────────────────────────────────────── */}
        <div className="card bg-brand-soft p-4 border border-brand/20 text-center">
          <p className="text-xs text-ink-soft font-medium mb-0.5">আজ ক্যাশ বাক্সে থাকার কথা (Expected Cash)</p>
          <p className="tnum text-3xl font-extrabold text-brand-deep">
            {money(c?.expected_cash ?? 0)}
          </p>

          <div className="mt-3 pt-2.5 border-t border-brand/15 grid grid-cols-3 gap-1 text-xs text-ink-soft">
            <div>
              <span className="block text-ink-faint">নগদ বিক্রি</span>
              <span className="tnum font-semibold text-ink">+{money(c?.cash_from_sales ?? 0)}</span>
            </div>
            <div>
              <span className="block text-ink-faint">বাকি আদায়</span>
              <span className="tnum font-semibold text-ink">+{money(c?.dues_collected_cash ?? 0)}</span>
            </div>
            <div>
              <span className="block text-ink-faint">নগদ খরচ</span>
              <span className="tnum font-semibold text-danger">−{money(c?.expenses ?? 0)}</span>
            </div>
          </div>
        </div>

        {/* ── Counted Drawer Cash ────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-ink">
              হাতে গোনা ক্যাশ (Counted Cash)
            </label>
            <button
              type="button"
              onClick={() => setShowDenominations(!showDenominations)}
              className="text-xs font-semibold text-brand hover:underline"
            >
              {showDenominations ? 'সাধারণ ইনপুট' : 'নোট গুনে লিখুন (Calculator)'}
            </button>
          </div>

          {showDenominations ? (
            <div className="space-y-2 bg-canvas p-3 rounded-card border border-rule">
              <span className="text-xs text-ink-soft block mb-1">কোন নোট কয়টি আছে:</span>
              <div className="grid grid-cols-2 gap-2">
                {NOTE_VALUES.map((val) => (
                  <div key={val} className="flex items-center justify-between bg-surface p-1.5 rounded-lg border border-rule">
                    <span className="tnum text-xs font-bold text-ink w-12">৳{val}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateNote(val, -1)}
                        className="h-6 w-6 rounded bg-canvas border border-rule flex items-center justify-center text-xs font-bold"
                      >
                        −
                      </button>
                      <span className="tnum text-xs font-semibold w-5 text-center">
                        {noteCounts[val] || 0}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateNote(val, 1)}
                        className="h-6 w-6 rounded bg-brand text-white flex items-center justify-center text-xs font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-end pt-1 font-semibold text-xs text-brand">
                মোট গণনাকৃত: {money(denominationTotal)}
              </div>
            </div>
          ) : (
            <AmountField
              value={manualCount}
              onChange={(next) => setManualCount(next)}
              placeholder={c?.expected_cash ? String(c.expected_cash) : '0'}
              aria-label="Counted Cash"
              emphasis
            />
          )}
        </div>

        {/* ── Variance / Reconciliation ──────────────────────────────────── */}
        {c && c.counted_cash !== null && c.variance !== null && (
          <div
            className={cn(
              'p-3.5 rounded-card border text-center transition-all animate-fade-in',
              c.variance === 0
                ? 'bg-ok-soft border-ok/30 text-ok'
                : c.variance > 0
                  ? 'bg-ok-soft border-ok/30 text-ok'
                  : 'bg-danger-soft border-danger/30 text-danger',
            )}
          >
            {c.variance === 0 ? (
              <div className="flex items-center justify-center gap-1.5 font-bold text-sm">
                <Icon name="check" size={18} />
                <span>অসাধারণ! ক্যাশ ও হিসাব সম্পূর্ণ মিলেছে!</span>
              </div>
            ) : c.variance > 0 ? (
              <div>
                <p className="text-xs font-medium">ক্যাশে উদ্বৃত্ত আছে (Extra Cash)</p>
                <p className="tnum text-2xl font-bold mt-0.5">+{money(c.variance)}</p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium">ক্যাশে ঘাটতি আছে (Shortage)</p>
                <p className="tnum text-2xl font-bold mt-0.5">−{money(Math.abs(c.variance))}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
