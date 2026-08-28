import { useCallback, useEffect, useRef, useState } from 'react'

export interface VoiceRecognitionOptions {
  lang?: string
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
  onResult,
}: VoiceRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<any>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  // Track whether the user explicitly stopped the mic
  const stoppedManuallyRef = useRef(false)
  // Accumulate confirmed final text across recognition sessions
  const finalTextRef = useRef('')

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (SpeechRecognition) {
      setSupported(true)
      const recognition = new SpeechRecognition()
      // Keep the microphone open across pauses
      recognition.continuous = true
      // Show words as they are spoken (not only when final)
      recognition.interimResults = true
      recognition.lang = lang
      // Give the engine more time to commit a result before timing out
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

        // Live transcript: show accumulated finals + current interim
        const live = (finalTextRef.current + ' ' + interim).trim()
        setTranscript(live)
      }

      recognition.onerror = (err: any) => {
        // 'no-speech' is fired after ~8 s silence; just restart automatically
        if (err.error === 'no-speech' && !stoppedManuallyRef.current) {
          // onend will fire next and we auto-restart there
          return
        }
        if (err.error !== 'aborted') {
          console.warn('Voice recognition error:', err.error || err)
        }
        if (err.error !== 'no-speech') {
          setIsListening(false)
        }
      }

      recognition.onend = () => {
        // If the user hasn't pressed stop, restart immediately to keep listening
        if (!stoppedManuallyRef.current) {
          try {
            recognition.start()
          } catch {
            // already starting, ignore
          }
        } else {
          // User pressed stop — fire onResult with everything collected
          const full = finalTextRef.current.trim()
          if (full && onResultRef.current) {
            onResultRef.current(full)
          }
          setIsListening(false)
        }
      }

      recognitionRef.current = recognition
    } else {
      setSupported(false)
    }

    return () => {
      if (recognitionRef.current) {
        stoppedManuallyRef.current = true
        try {
          recognitionRef.current.abort()
        } catch {
          // ignore
        }
      }
    }
  }, [lang])

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
    if (recognitionRef.current) {
      stoppedManuallyRef.current = true
      try {
        recognitionRef.current.stop()
      } catch {
        // already stopped
      }
    }
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
    toggle,
  }
}
