import { useCallback, useEffect, useRef, useState } from 'react'

export interface VoiceRecognitionOptions {
  lang?: string
  autoStopMs?: number // Automatically stop and trigger onResult after silence (default: 1800ms)
  onResult?: (transcript: string) => void
}

// Browser Web Speech API interfaces
interface SpeechRecognitionResultItem {
  transcript: string
}
interface SpeechRecognitionResultList {
  [index: number]: {
    [index: number]: SpeechRecognitionResultItem
    isFinal: boolean
    length: number
  }
  length: number
}
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

export function useVoiceRecognition({
  lang = 'bn-BD',
  autoStopMs = 2000,
  onResult,
}: VoiceRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<any>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const stoppedManuallyRef = useRef(false)
  const finalTextRef = useRef('')
  const silenceTimerRef = useRef<any>(null)

  const fireResult = useCallback((text: string) => {
    const cleaned = text.trim()
    if (cleaned && onResultRef.current) {
      onResultRef.current(cleaned)
    }
  }, [])

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (SpeechRecognition) {
      setSupported(true)
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = lang
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        setIsListening(true)
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = ''
        let sessionFinal = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result && result[0]) {
            if (result.isFinal) {
              sessionFinal += result[0].transcript
            } else {
              interim += result[0].transcript
            }
          }
        }

        if (sessionFinal) {
          finalTextRef.current = (finalTextRef.current + ' ' + sessionFinal).trim()
        }

        const live = (finalTextRef.current + ' ' + interim).trim()
        setTranscript(live)

        // Reset silence timer on incoming speech
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        if (autoStopMs > 0 && live) {
          silenceTimerRef.current = setTimeout(() => {
            if (!stoppedManuallyRef.current) {
              fireResult(live)
            }
          }, autoStopMs)
        }
      }

      recognition.onerror = (err: any) => {
        if (err.error === 'no-speech' && !stoppedManuallyRef.current) {
          return
        }
        if (err.error !== 'aborted') {
          console.warn('[voice] Recognition error:', err.error || err)
        }
        if (err.error !== 'no-speech') {
          setIsListening(false)
        }
      }

      recognition.onend = () => {
        if (!stoppedManuallyRef.current) {
          try {
            recognition.start()
          } catch {
            // ignore
          }
        } else {
          const full = finalTextRef.current.trim()
          if (full) {
            fireResult(full)
          }
          setIsListening(false)
        }
      }

      recognitionRef.current = recognition
    } else {
      setSupported(false)
    }

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      if (recognitionRef.current) {
        stoppedManuallyRef.current = true
        try {
          recognitionRef.current.abort()
        } catch {
          // ignore
        }
      }
    }
  }, [lang, autoStopMs, fireResult])

  const start = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      stoppedManuallyRef.current = false
      finalTextRef.current = ''
      setTranscript('')
      try {
        recognitionRef.current.start()
      } catch {
        // already active
      }
    }
  }, [isListening])

  const stop = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (recognitionRef.current) {
      stoppedManuallyRef.current = true
      try {
        recognitionRef.current.stop()
      } catch {
        // already stopped
      }
    }
  }, [])

  const reset = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    finalTextRef.current = ''
    setTranscript('')
  }, [])

  const toggle = useCallback(() => {
    if (isListening) {
      stop()
    } else {
      start()
    }
  }, [isListening, start, stop])

  return {
    supported,
    isListening,
    transcript,
    start,
    stop,
    reset,
    toggle,
  }
}

