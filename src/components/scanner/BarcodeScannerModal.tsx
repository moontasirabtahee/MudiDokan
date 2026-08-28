import { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Field'

interface BarcodeScannerModalProps {
  open: boolean
  onClose: () => void
  onScan: (barcode: string) => void
  title?: string
}

export function BarcodeScannerModal({
  open,
  onClose,
  onScan,
  title,
}: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [hasCamera, setHasCamera] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<number | null>(null)

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime) // A5 beep
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
    } catch {
      // AudioContext unavailable or blocked
    }
  }

  function handleSuccess(barcode: string) {
    playBeep()
    onScan(barcode.trim())
    onClose()
  }

  useEffect(() => {
    if (!open) {
      stopCamera()
      return
    }

    startCamera()

    return () => {
      stopCamera()
    }
  }, [open])

  async function startCamera() {
    setErrorMsg(null)

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setHasCamera(false)
        setErrorMsg('Camera access is not supported on this device/browser.')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      // Check for BarcodeDetector API
      const BarcodeDetectorAPI = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector

      if (BarcodeDetectorAPI) {
        const detector = new BarcodeDetectorAPI({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
        })

        intervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              const code = barcodes[0].rawValue
              if (code) {
                stopCamera()
                handleSuccess(code)
              }
            }
          } catch {
            // Detection error on frame
          }
        }, 250)
      }
    } catch (err: unknown) {
      console.warn('Camera stream error:', err)
      setHasCamera(false)
      setErrorMsg('ক্যামেরা চালু করা যায়নি। অনুগ্রহ করে ব্রাউজারে ক্যামেরার অনুমতি দিন।')
    }
  }

  function stopCamera() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade-in">
      <div className="card w-full max-w-sm overflow-hidden bg-surface shadow-lift border border-rule">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rule p-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Icon name="barcode" size={20} />
            </span>
            <span className="font-semibold text-ink text-base">
              {title || 'বারকোড স্ক্যানার'}
            </span>
          </div>
          <IconButton name="close" label="Close" variant="ghost" onClick={onClose} />
        </div>

        {/* Camera Viewport or Fallback */}
        <div className="relative aspect-[4/3] w-full bg-black overflow-hidden flex items-center justify-center">
          {hasCamera ? (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
              />

              {/* Targeting Reticle & Laser */}
              <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-dashed border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div className="absolute inset-x-2 top-1/2 h-0.5 bg-danger shadow-[0_0_8px_#ef4444] animate-pulse" />
              </div>

              <div className="absolute bottom-2 inset-x-0 text-center">
                <span className="bg-black/60 text-white text-xs px-2.5 py-1 rounded-full font-medium">
                  পণ্যের বারকোড ফ্রেমের মাঝে রাখুন
                </span>
              </div>
            </>
          ) : (
            <div className="p-4 text-center text-white/80">
              <Icon name="camera" size={36} className="mx-auto mb-2 opacity-60 text-white" />
              <p className="text-xs text-white/70">{errorMsg || 'Camera unavailable'}</p>
            </div>
          )}
        </div>

        {/* Manual Barcode Entry Fallback */}
        <div className="p-3.5 bg-canvas/40 border-t border-rule">
          <label className="text-xs text-ink-soft font-medium mb-1.5 block">
            অথবা নিজে বারকোড নম্বর লিখুন:
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (manualCode.trim()) {
                handleSuccess(manualCode.trim())
              }
            }}
            className="flex gap-2"
          >
            <Input
              type="text"
              placeholder="যেমন: 8941100..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="font-mono text-sm"
              autoFocus={!hasCamera}
            />
            <Button type="submit" variant="primary" disabled={!manualCode.trim()}>
              যোগ করুন
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
