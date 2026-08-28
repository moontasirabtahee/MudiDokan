import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeAudioWithWhisper } from '@/lib/voice'

export interface VoiceRecognitionOptions {
  lang?: string
  autoStopMs?: number // Automatically stop and trigger onResult after silence (default: 2000ms)
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
  autoStopMs = 4500,
  onResult,
}: VoiceRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [supported, setSupported] = useState(true)

  const recognitionRef = useRef<any>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const stoppedManuallyRef = useRef(false)
  const accumulatedTextRef = useRef('')
  const currentSegmentRef = useRef('')
  const silenceTimerRef = useRef<any>(null)

  const fireResult = useCallback(async (fallbackSegment: string) => {
    let segmentText = fallbackSegment.trim()

    // 1. If we recorded audio with MediaRecorder, transcribe with Groq Whisper
    if (audioChunksRef.current.length > 0) {
      const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm'
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
      audioChunksRef.current = []

      if (audioBlob.size > 2000) {
        setIsTranscribing(true)
        try {
          const whisperText = await transcribeAudioWithWhisper(audioBlob)
          if (whisperText && whisperText.trim()) {
            segmentText = whisperText.trim()
          }
        } catch (err) {
          console.warn('[voice] Whisper transcribe fallback:', err)
        } finally {
          setIsTranscribing(false)
        }
      }
    }

    if (segmentText) {
      const prev = accumulatedTextRef.current.trim()
      const combined = prev
        ? prev.endsWith(',') || prev.endsWith('এবং') || prev.endsWith('আর')
          ? `${prev} ${segmentText}`
          : `${prev}, ${segmentText}`
        : segmentText

      accumulatedTextRef.current = combined
      setTranscript(combined)

      if (onResultRef.current) {
        onResultRef.current(combined)
      }
    } else if (accumulatedTextRef.current) {
      if (onResultRef.current) {
        onResultRef.current(accumulatedTextRef.current)
      }
    }
  }, [])

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
  }, [])

  // Initialize Web Speech API for parallel live interim text
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = lang
      recognition.maxAlternatives = 1

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
          currentSegmentRef.current = (currentSegmentRef.current + ' ' + sessionFinal).trim()
        }

        const liveSegment = (currentSegmentRef.current + ' ' + interim).trim()
        const prev = accumulatedTextRef.current.trim()
        const liveFull = prev && liveSegment ? `${prev}, ${liveSegment}` : (liveSegment || prev)
        setTranscript(liveFull)

        // Reset silence timer on incoming speech
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        if (autoStopMs > 0 && liveSegment) {
          silenceTimerRef.current = setTimeout(() => {
            if (!stoppedManuallyRef.current) {
              stop()
            }
          }, autoStopMs)
        }
      }

      recognition.onerror = (err: any) => {
        if (err.error !== 'no-speech' && err.error !== 'aborted') {
          console.warn('[voice] WebSpeech error:', err.error || err)
        }
      }

      recognitionRef.current = recognition
    }

    // Check microphone availability
    if (typeof navigator !== 'undefined' && !navigator.mediaDevices?.getUserMedia) {
      setSupported(Boolean(SpeechRecognition))
    }

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      cleanupStream()
    }
  }, [lang, autoStopMs, cleanupStream])

  const start = useCallback(async () => {
    stoppedManuallyRef.current = false
    currentSegmentRef.current = ''
    audioChunksRef.current = []
    setIsListening(true)

    // 1. Start audio stream recording for Whisper
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream

        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
        const supportedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || ''

        const recorder = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : undefined)
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data)
          }
        }
        recorder.start(250) // collect chunks every 250ms
        mediaRecorderRef.current = recorder
      } catch (err) {
        console.warn('[voice] Microphone capture error:', err)
      }
    }

    // 2. Start Web Speech recognition for live preview
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start()
      } catch {
        // already active
      }
    }
  }, [])

  const stop = useCallback(() => {
    stoppedManuallyRef.current = true
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    setIsListening(false)

    // Stop Web Speech
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // already stopped
      }
    }

    // Stop MediaRecorder and trigger Whisper transcription
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = () => {
        cleanupStream()
        void fireResult(currentSegmentRef.current)
      }
      try {
        mediaRecorderRef.current.stop()
      } catch {
        cleanupStream()
        void fireResult(currentSegmentRef.current)
      }
    } else {
      cleanupStream()
      void fireResult(currentSegmentRef.current)
    }
  }, [cleanupStream, fireResult])

  const reset = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    cleanupStream()
    accumulatedTextRef.current = ''
    currentSegmentRef.current = ''
    audioChunksRef.current = []
    setTranscript('')
    setIsListening(false)
    setIsTranscribing(false)
  }, [cleanupStream])

  const toggle = useCallback(() => {
    if (isListening) {
      stop()
    } else {
      void start()
    }
  }, [isListening, start, stop])

  return {
    supported,
    isListening,
    isTranscribing,
    transcript,
    start,
    stop,
    reset,
    toggle,
  }
}

