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

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (SpeechRecognition) {
      setSupported(true)
      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = lang

      recognition.onstart = () => {
        setIsListening(true)
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = ''
        let final = ''

        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i]
          if (result && result[0]) {
            if (result.isFinal) {
              final += result[0].transcript
            } else {
              interim += result[0].transcript
            }
          }
        }

        const current = (final || interim).trim()
        setTranscript(current)

        if (final && onResultRef.current) {
          onResultRef.current(final.trim())
        }
      }

      recognition.onerror = (err: any) => {
        if (err.error !== 'no-speech') {
          console.warn('Voice recognition error:', err.error || err)
        }
        setIsListening(false)
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current = recognition
    } else {
      setSupported(false)
    }

    return () => {
      if (recognitionRef.current) {
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
      setTranscript('')
      try {
        recognitionRef.current.start()
      } catch {
        // already active
      }
    }
  }, [isListening])

  const stop = useCallback(() => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop()
      } catch {
        // already stopped
      }
    }
  }, [isListening])

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
