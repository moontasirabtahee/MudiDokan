import { useEffect, useState } from 'react'
import { Button, IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import type { ProductStatus } from '@/lib/database.types'
import { matchesSearch } from '@/lib/utils'

interface VoiceSearchModalProps {
  open: boolean
  onClose: () => void
  products?: ProductStatus[]
  onSelectProduct?: (product: ProductStatus, quantity: number) => void
  onSetSearch?: (query: string) => void
}

/**
 * Parses Bengali numbers and text quantities (যেমন: "২ কেজি", "১ লিটার", "আধা কেজি")
 */
function parseVoiceQty(phrase: string): { qty: number; cleanName: string } {
  let text = phrase.trim()
  let qty = 1

  // Replace Bengali digits with English digits
  const bnToEn: Record<string, string> = {
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  }
  const normalized = text.replace(/[০-৯]/g, (d) => bnToEn[d] || d)

  // Check for half / আধা / পৌনে
  if (normalized.includes('আধা') || normalized.includes('half')) {
    qty = 0.5
    text = text.replace(/আধা|half/gi, '').trim()
  } else {
    // Match leading or embedded number (e.g. "2 কেজি" or "5 পিস")
    const match = normalized.match(/(\d+(\.\d+)?)\s*(কেজি|গ্রাম|লিটার|পিস|প্যাকেট|ডজন|হালি|বস্তা|ব্যাগ|kg|litre|packet|piece)?/i)
    if (match && match[1]) {
      const parsed = parseFloat(match[1])
      if (!isNaN(parsed) && parsed > 0) {
        qty = parsed
        // Remove the parsed quantity and unit from the product name
        text = text.replace(match[0], '').trim()
      }
    }
  }

  // Remove common filler words
  text = text.replace(/(দিন|দাও|লাগবে|চাই|নেন|দেন|একটু)/g, '').trim()

  return { qty, cleanName: text }
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

  const voice = useVoiceRecognition({
    lang: 'bn-BD',
    onResult: (spokenText) => {
      handleSpoken(spokenText)
    },
  })

  useEffect(() => {
    if (open) {
      setMatchedProduct(null)
      voice.start()
    } else {
      voice.stop()
    }
  }, [open])

  function handleSpoken(spoken: string) {
    if (!spoken.trim()) return

    const { qty, cleanName } = parseVoiceQty(spoken)
    setMatchedQty(qty)

    // Search catalog for match
    const target = cleanName.trim()
    if (target && products.length > 0) {
      const found = products.find((p) =>
        matchesSearch(target, p.name, p.name_bn, p.sku, p.barcode),
      )
      if (found) {
        setMatchedProduct(found)
        return
      }
    }

    // If no exact match found, pass search query to search input
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
        <div className="min-h-16 p-3 rounded-lg bg-canvas border border-rule flex flex-col items-center justify-center mb-4">
          {voice.transcript ? (
            <p className="text-base font-semibold text-ink">"{voice.transcript}"</p>
          ) : (
            <p className="text-xs text-ink-faint italic">আপনার কথা শোনা হচ্ছে...</p>
          )}

          {matchedProduct && (
            <div className="mt-2 text-xs text-ok font-semibold bg-ok-soft px-2.5 py-1 rounded-full flex items-center gap-1">
              <Icon name="check" size={14} />
              <span>পণ্য পাওয়া গেছে: {matchedProduct.name_bn || matchedProduct.name} ({matchedQty} {matchedProduct.unit})</span>
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
