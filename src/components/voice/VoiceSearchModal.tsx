import { useEffect, useState } from 'react'
import { Button, IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import type { ProductStatus } from '@/lib/database.types'
import { matchesSearch } from '@/lib/utils'
import { llmParseSellItems, parseMultiSellItems, type ParsedSellItem } from '@/lib/voice'

export interface MatchedCartItem {
  parsed: ParsedSellItem
  product: ProductStatus | null
  quantity: number
}

interface VoiceSearchModalProps {
  open: boolean
  onClose: () => void
  products?: ProductStatus[]
  onSelectProduct?: (product: ProductStatus, quantity: number) => void
  onAddMultiple?: (items: Array<{ product: ProductStatus; quantity: number }>) => void
  onSetSearch?: (query: string) => void
}

export function VoiceSearchModal({
  open,
  onClose,
  products = [],
  onSelectProduct,
  onAddMultiple,
  onSetSearch,
}: VoiceSearchModalProps) {
  const [matchedItems, setMatchedItems] = useState<MatchedCartItem[]>([])
  const [aiProcessing, setAiProcessing] = useState(false)
  const [processedText, setProcessedText] = useState('')

  const voice = useVoiceRecognition({
    lang: 'bn-BD',
    autoStopMs: 2000,
    onResult: (spokenText) => {
      void handleSpoken(spokenText)
    },
  })

  useEffect(() => {
    if (open) {
      setMatchedItems([])
      setAiProcessing(false)
      setProcessedText('')
      voice.start()
    } else {
      voice.stop()
    }
  }, [open])

  async function handleSpoken(spoken: string) {
    if (!spoken.trim() || spoken.trim() === processedText) return
    setProcessedText(spoken.trim())
    setAiProcessing(true)

    // 1. Send spoken transcript and database product catalog to LLM
    let parsedList = await llmParseSellItems(
      spoken,
      products.map((p) => ({
        id: p.id,
        name: p.name,
        name_bn: p.name_bn,
        unit: p.unit,
        sell_price: p.sell_price,
      })),
    )

    // 2. Fallback to local regex multi-parser if offline
    if (!parsedList || parsedList.length === 0) {
      parsedList = parseMultiSellItems(spoken)
    }

    // Match each extracted item against the database products
    const matches: MatchedCartItem[] = []

    for (const item of parsedList) {
      let found: ProductStatus | null = null

      // First priority: Exact database product ID returned by LLM
      if (item.product_id && products.length > 0) {
        found = products.find((p) => p.id === item.product_id) ?? null
      }

      // Second priority: Fuzzy matching by name/SKU/barcode
      if (!found && products.length > 0) {
        const searchTarget = (item.name_bn || item.name).trim()
        if (searchTarget) {
          found =
            products.find((p) => matchesSearch(searchTarget, p.name, p.name_bn, p.sku, p.barcode)) ??
            products.find((p) => {
              const pName = (p.name_bn || p.name).toLowerCase()
              const sName = searchTarget.toLowerCase()
              return pName.includes(sName) || sName.includes(pName)
            }) ??
            null
        }
      }

      matches.push({
        parsed: item,
        product: found,
        quantity: item.quantity > 0 ? item.quantity : 1,
      })
    }

    setMatchedItems(matches)
    setAiProcessing(false)
  }

  function updateQuantity(index: number, delta: number) {
    setMatchedItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        const newQty = Math.max(0.25, Math.round((item.quantity + delta) * 100) / 100)
        return { ...item, quantity: newQty }
      }),
    )
  }

  function handleAddAll() {
    const readyToAdd = matchedItems
      .filter((m) => m.product !== null)
      .map((m) => ({ product: m.product!, quantity: m.quantity }))

    if (readyToAdd.length > 0) {
      if (onAddMultiple) {
        onAddMultiple(readyToAdd)
      } else if (onSelectProduct) {
        for (const item of readyToAdd) {
          onSelectProduct(item.product, item.quantity)
        }
      }
      onClose()
    } else if (onSetSearch && voice.transcript) {
      onSetSearch(voice.transcript)
      onClose()
    }
  }

  function handleAddSingle(m: MatchedCartItem) {
    if (m.product && onSelectProduct) {
      onSelectProduct(m.product, m.quantity)
      setMatchedItems((prev) => prev.filter((item) => item !== m))
    }
  }

  if (!open) return null

  const foundCount = matchedItems.filter((m) => m.product !== null).length

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4 animate-fade-in">
      <div className="card w-full max-w-md overflow-hidden bg-surface shadow-lift border border-rule p-5 space-y-4 max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-card pb-safe sm:pb-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-rule">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Icon name="mic" size={20} />
            </span>
            <div>
              <h3 className="font-bold text-base text-ink">মুখে বলে কার্টে যোগ করুন</h3>
              <p className="text-xs text-ink-soft">এক বা একাধিক পণ্যের নাম ও পরিমাণ বলুন</p>
            </div>
          </div>
          <IconButton name="close" label="Close" variant="ghost" onClick={onClose} />
        </div>

        {/* Mic Pulse Button */}
        <div className="flex items-center justify-center py-2">
          <div className="relative flex items-center justify-center">
            {voice.isListening && (
              <>
                <div className="absolute -inset-2 rounded-full bg-brand/20 animate-ping" />
                <div className="absolute -inset-1 rounded-full bg-brand/30 animate-pulse" />
              </>
            )}
            <button
              type="button"
              onClick={() => voice.toggle()}
              className={`relative flex h-16 w-16 items-center justify-center rounded-full shadow-md transition-all ${
                voice.isListening
                  ? 'bg-brand text-white scale-105'
                  : 'bg-canvas border-2 border-rule text-ink-faint'
              }`}
            >
              <Icon name={voice.isListening ? 'mic' : 'micOff'} size={28} />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-ink-soft">
          {voice.isListening ? (
            <span className="text-brand font-semibold animate-pulse">
              🎙️ শুনছি... বলুন: "২ কেজি চিনি, ১ লিটার তেল, ১ ডজন ডিম"
            </span>
          ) : (
            <span>মাইক্রোফোনে চাপ দিয়ে কথা বলুন</span>
          )}
        </p>

        {/* Spoken Text Display */}
        {(voice.transcript || aiProcessing) && (
          <div className="p-3 rounded-lg bg-canvas border border-rule text-center space-y-1">
            {voice.transcript && (
              <p className="text-sm font-semibold text-ink">"{voice.transcript}"</p>
            )}
            {aiProcessing && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-brand font-semibold animate-pulse">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                AI তালিকা বিশ্লেষণ করছে...
              </div>
            )}
          </div>
        )}

        {/* Parsed & Matched Items List */}
        {matchedItems.length > 0 && (
          <div className="space-y-2 flex-1 overflow-y-auto pr-1">
            <p className="text-xs font-bold text-ink-soft">চিহ্নিত পণ্য তালিকা ({matchedItems.length}টি):</p>
            <div className="space-y-2">
              {matchedItems.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-2.5 rounded-card border ${
                    m.product
                      ? 'bg-ok-soft/30 border-ok/30'
                      : 'bg-canvas border-rule'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        m.product ? 'bg-ok text-white' : 'bg-rule text-ink-soft'
                      }`}
                    >
                      {m.product ? <Icon name="check" size={14} /> : idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink truncate">
                        {m.product ? (m.product.name_bn || m.product.name) : (m.parsed.name_bn || m.parsed.name)}
                      </p>
                      <p className="text-xs text-ink-soft truncate">
                        পরিমাণ: <span className="font-semibold text-brand">{m.quantity} {m.parsed.unit || m.product?.unit || 'পিস'}</span>
                        {m.product ? ` · ৳${m.product.sell_price}/একক` : ' (দোকানে পাওয়া যায়নি)'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center rounded-lg border border-rule bg-canvas">
                      <button
                        type="button"
                        onClick={() => updateQuantity(idx, -1)}
                        className="px-2 py-1 text-ink-soft hover:text-ink text-xs font-bold"
                        title="কমান"
                      >
                        -
                      </button>
                      <span className="px-1 text-xs font-bold text-ink min-w-[24px] text-center tnum">
                        {m.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(idx, 1)}
                        className="px-2 py-1 text-ink-soft hover:text-ink text-xs font-bold"
                        title="বাড়ান"
                      >
                        +
                      </button>
                    </div>

                    {m.product && (
                      <button
                        type="button"
                        onClick={() => handleAddSingle(m)}
                        className="px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg bg-brand text-white hover:bg-brand-deep shadow-2xs shrink-0 active:scale-95 transition-all"
                      >
                        + যোগ
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2.5 pt-2 border-t border-rule">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            বাতিল
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!voice.transcript && matchedItems.length === 0}
            icon="check"
            onClick={handleAddAll}
          >
            {foundCount > 0
              ? `যোগ করুন (${foundCount})`
              : 'খুঁজুন'}
          </Button>
        </div>
      </div>
    </div>
  )
}

