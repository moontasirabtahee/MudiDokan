import { useEffect, useState } from 'react'
import { Button, IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Field'
import { AmountField, NumericField } from '@/components/ui/NumberField'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import { createProduct } from '@/data/products'
import { UNIT_OPTIONS } from '@/lib/constants'
import type { UnitType } from '@/lib/database.types'
import { rpc } from '@/lib/supabase'
import { newId } from '@/lib/utils'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import { BarcodeScannerModal } from '@/components/scanner/BarcodeScannerModal'

interface VoiceProductCreateModalProps {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}

import { parseSpokenProduct } from '@/lib/voice'

export function VoiceProductCreateModal({
  open,
  onClose,
  onCreated,
}: VoiceProductCreateModalProps) {
  const { shopId } = useShop()
  const toast = useToast()

  const [name, setName] = useState('')
  const [buyPrice, setBuyPrice] = useState<number | null>(null)
  const [sellPrice, setSellPrice] = useState<number | null>(null)
  const [stock, setStock] = useState<number | null>(null)
  const [unit, setUnit] = useState<UnitType>('piece')
  const [barcode, setBarcode] = useState('')
  const [saving, setSaving] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const voice = useVoiceRecognition({
    lang: 'bn-BD',
    onResult: (spokenText) => {
      handleSpoken(spokenText)
    },
  })

  useEffect(() => {
    if (open) {
      resetForm()
      voice.start()
    } else {
      voice.stop()
    }
  }, [open])

  function resetForm() {
    setName('')
    setBuyPrice(null)
    setSellPrice(null)
    setStock(null)
    setUnit('piece')
    setBarcode('')
  }

  function handleSpoken(spoken: string) {
    if (!spoken.trim()) return
    const parsed = parseSpokenProduct(spoken)
    if (parsed.name) setName(parsed.name)
    if (parsed.buyPrice !== null) setBuyPrice(parsed.buyPrice)
    if (parsed.sellPrice !== null) setSellPrice(parsed.sellPrice)
    if (parsed.stock !== null) setStock(parsed.stock)
    if (parsed.unit) setUnit(parsed.unit)
  }

  async function handleSave(keepOpen = false) {
    if (!shopId || !name.trim() || sellPrice === null || sellPrice <= 0) {
      toast.say('error.required')
      return
    }

    setSaving(true)
    try {
      const created = await createProduct(shopId, {
        name: name.trim(),
        name_bn: name.trim(),
        buy_price: buyPrice ?? 0,
        sell_price: sellPrice,
        unit,
        is_weighted: unit === 'kg' || unit === 'gram',
        low_stock_threshold: unit === 'kg' ? 5 : 2,
        barcode: barcode.trim() || null,
      })

      // If initial opening stock was provided, record stock entry
      if (stock && stock > 0 && created.id) {
        try {
          await rpc('adjust_stock', {
            payload: {
              client_uuid: newId(),
              shop_id: shopId,
              product_id: created.id,
              delta: stock,
              reason: 'opening',
              note: 'Opening stock added via voice',
            },
          })
        } catch {
          // non-blocking
        }
      }

      toast.say('common.saved')
      if (onCreated) onCreated()

      if (keepOpen) {
        resetForm()
        voice.start()
      } else {
        onClose()
      }
    } catch (err: unknown) {
      toast.say('error.server')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade-in">
      <div className="card w-full max-w-md overflow-hidden bg-surface shadow-lift border border-rule p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-rule">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Icon name="mic" size={20} />
            </span>
            <div>
              <h3 className="font-bold text-base text-ink">মুখে বলে পণ্য যোগ</h3>
              <p className="text-xs text-ink-soft">নাম, কেনা দাম, বেচা দাম ও স্টক বলুন</p>
            </div>
          </div>
          <IconButton name="close" label="Close" variant="ghost" onClick={onClose} />
        </div>

        {/* Mic Pulse Button */}
        <div className="flex items-center justify-center py-2">
          <div className="relative flex items-center justify-center">
            {voice.isListening && (
              <div className="absolute -inset-2 rounded-full bg-brand/25 animate-ping" />
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
              🎙️ শুনছি... বলুন: "চিনি, কেনা ১২০, বেচা ১৩০, স্টক ৫০ কেজি"
            </span>
          ) : (
            <span>মাইক্রোফোনে চাপ দিয়ে কথা বলুন</span>
          )}
        </p>

        {voice.transcript ? (
          <div className="p-2.5 rounded-lg bg-canvas border border-rule text-center">
            <p className="text-xs text-ink-faint">আপনি বলেছেন:</p>
            <p className="text-sm font-semibold text-ink mt-0.5">"{voice.transcript}"</p>
          </div>
        ) : null}

        {/* Parsed Fields Preview & Edit */}
        <div className="space-y-3 pt-1">
          <div>
            <label className="text-xs font-semibold text-ink block mb-1">পণ্যের নাম *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="যেমন: চিনি / সয়াবিন তেল"
              className="text-sm font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink block mb-1">কেনার দাম (৳)</label>
              <AmountField
                value={buyPrice}
                onChange={setBuyPrice}
                placeholder="যেমন: ১২০"
                aria-label="Buy Price"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink block mb-1">বিক্রির দাম (৳) *</label>
              <AmountField
                value={sellPrice}
                onChange={setSellPrice}
                placeholder="যেমন: ১৩০"
                aria-label="Sell Price"
                emphasis
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink block mb-1">স্টক / পরিমাণ</label>
              <NumericField
                value={stock}
                onChange={setStock}
                placeholder="যেমন: ৫০"
                aria-label="Stock"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink block mb-1">একক (Unit)</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as UnitType)}
                className="w-full h-11 rounded-card border border-rule bg-surface px-2.5 text-sm font-medium text-ink"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.bn}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Barcode Strip */}
          <div>
            <label className="text-xs font-semibold text-ink block mb-1">বারকোড / কিউআর (ঐচ্ছিক)</label>
            <div className="flex gap-2">
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="বারকোড নম্বর..."
                className="font-mono text-sm flex-1"
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                title="বারকোড স্ক্যান করুন"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-rule bg-canvas text-brand hover:bg-brand-soft"
              >
                <Icon name="barcode" size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2.5 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            loading={saving}
            disabled={!name.trim() || !sellPrice}
            onClick={() => void handleSave(true)}
          >
            + আরেকটি যোগ করুন
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            loading={saving}
            disabled={!name.trim() || !sellPrice}
            icon="check"
            onClick={() => void handleSave(false)}
          >
            পণ্য সেভ করুন
          </Button>
        </div>
      </div>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(code) => setBarcode(code)}
        title="পণ্যের বারকোড স্ক্যান"
      />
    </div>
  )
}
