import { useEffect, useState } from 'react'
import { Button, IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import type { ProductStatus } from '@/lib/database.types'
import { matchesSearch } from '@/lib/utils'
import { llmSearchProduct, parseVoiceQty } from '@/lib/voice'

interface VoiceSearchModalProps {
  open: boolean
  onClose: () => void
  products?: ProductStatus[]
  onSelectProduct?: (product: ProductStatus, quantity: number) => void
  onSetSearch?: (query: string) => void
}

export function VoiceSearchModal({
  open,
  onClose,
  products = [],
  onSelectProduct,
  onSetSearch,
}: VoiceSearchModalProps) {
  const [matchedProduct, setMatchedProduct] = useState<ProductStatus | null>(null)
  const [matchedQty, setMatchedQty] = useState<number>(1)
  const [aiProcessing, setAiProcessing] = useState(false)

  const voice = useVoiceRecognition({
    lang: 'bn-BD',
    onResult: (spokenText) => {
      void handleSpoken(spokenText)
    },
  })

  useEffect(() => {
    if (open) {
      setMatchedProduct(null)
      setAiProcessing(false)
      voice.start()
    } else {
      voice.stop()
    }
  }, [open])

  async function handleSpoken(spoken: string) {
    if (!spoken.trim()) return

    setAiProcessing(true)

    // 1. Try LLM first for intelligent extraction
    const llmResult = await llmSearchProduct(spoken)

    let searchName: string
    let qty: number

    if (llmResult && llmResult.productName) {
      searchName = llmResult.productName_bn || llmResult.productName
      qty = llmResult.quantity
    } else {
      // 2. Fallback to regex qty parser
      const parsed = parseVoiceQty(spoken)
      searchName = parsed.cleanName
      qty = parsed.qty
    }

    setMatchedQty(qty)
    setAiProcessing(false)

    // Search catalog
    const target = searchName.trim()
    if (target && products.length > 0) {
      const found = products.find((p) =>
        matchesSearch(target, p.name, p.name_bn, p.sku, p.barcode),
      )
      if (found) {
        setMatchedProduct(found)
        return
      }
    }

    // No exact match — pass as search query
    if (onSetSearch && target) {
      onSetSearch(target)
    }
  }

  function handleConfirmAdd() {
    if (matchedProduct && onSelectProduct) {
      onSelectProduct(matchedProduct, matchedQty)
      onClose()
    } else if (onSetSearch && voice.transcript) {
      const { cleanName } = parseVoiceQty(voice.transcript)
      onSetSearch(cleanName || voice.transcript)
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-fade-in">
      <div className="card w-full max-w-sm overflow-hidden bg-surface shadow-lift border border-rule text-center p-6">
        <div className="flex justify-end -mt-2 -mr-2">
          <IconButton name="close" label="Close" variant="ghost" onClick={onClose} />
        </div>

        {/* Pulsing Mic Circle */}
        <div className="relative mx-auto my-4 flex h-24 w-24 items-center justify-center">
          {voice.isListening && (
            <>
              <div className="absolute inset-0 rounded-full bg-brand/20 animate-ping" />
              <div className="absolute inset-2 rounded-full bg-brand/30 animate-pulse" />
            </>
          )}
          <button
            type="button"
            onClick={() => voice.toggle()}
            className={`relative flex h-20 w-20 items-center justify-center rounded-full shadow-md transition-all ${
              voice.isListening
                ? 'bg-brand text-white scale-105'
                : 'bg-canvas border-2 border-rule text-ink-faint'
            }`}
          >
            <Icon name={voice.isListening ? 'mic' : 'micOff'} size={36} />
          </button>
        </div>

        <h3 className="text-lg font-bold text-ink mb-1">
          {voice.isListening ? 'কথা বলুন...' : 'মাইক্রোফোনে চাপ দিন'}
        </h3>
        <p className="text-xs text-ink-soft mb-4">
          যেমন: <span className="font-semibold text-brand">"২ কেজি চিনি"</span> বা <span className="font-semibold text-brand">"১ লিটার সয়াবিন তেল"</span>
        </p>

        {/* Spoken text display */}
        <div className="min-h-16 p-3 rounded-lg bg-canvas border border-rule flex flex-col items-center justify-center mb-4 gap-1.5">
          {voice.transcript ? (
            <p className="text-base font-semibold text-ink">"{voice.transcript}"</p>
          ) : (
            <p className="text-xs text-ink-faint italic">আপনার কথা শোনা হচ্ছে...</p>
          )}

          {aiProcessing && (
            <div className="flex items-center gap-1.5 text-xs text-brand font-semibold animate-pulse">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              AI খুঁজছে...
            </div>
          )}

          {matchedProduct && !aiProcessing && (
            <div className="mt-1 text-xs text-ok font-semibold bg-ok-soft px-2.5 py-1 rounded-full flex items-center gap-1">
              <Icon name="check" size={14} />
              <span>✨ পণ্য পাওয়া গেছে: {matchedProduct.name_bn || matchedProduct.name} ({matchedQty} {matchedProduct.unit})</span>
            </div>
          )}

        </div>

        <div className="flex gap-2">
          <Button variant="outline" block onClick={onClose}>
            বাতিল
          </Button>
          <Button
            variant="primary"
            block
            disabled={!voice.transcript && !matchedProduct}
            onClick={handleConfirmAdd}
          >
            {matchedProduct ? `কার্টে যোগ করুন (${matchedQty})` : 'খুঁজুন'}
          </Button>
        </div>
      </div>
    </div>
  )
}
