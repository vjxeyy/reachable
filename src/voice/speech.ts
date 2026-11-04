// Browser speech: reading steps aloud (speechSynthesis) and hearing one request (SpeechRecognition).
// No React in here. Each step is its own utterance, because Chrome cuts off long ones.
// If the browser lacks either feature, the can... functions say so and the app keeps its manual controls.

// ---------- Reading aloud ----------

export type SpeakStatus = 'idle' | 'speaking' | 'paused'

export interface SpeakState {
  /** Which set of directions is being read (or was last read), so only its own panel shows the controls. */
  owner: string | null
  status: SpeakStatus
  /** Zero-based index of the step being read. */
  index: number
  total: number
  /** Why reading is not running: finished by itself, or stopped by the person. */
  ended: 'finished' | 'stopped' | null
}

const IDLE: SpeakState = { owner: null, status: 'idle', index: 0, total: 0, ended: null }

let state: SpeakState = IDLE
let token = 0
/** Held so the browser does not garbage collect the utterance before it ends (a known Chrome problem). */
const held: SpeechSynthesisUtterance[] = []
const listeners = new Set<() => void>()

function set(next: SpeakState): void {
  state = next
  listeners.forEach((fn) => fn())
}

export function getSpeakState(): SpeakState {
  return state
}

export function subscribeSpeech(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

function voiceLanguage(): string {
  const lang = typeof navigator !== 'undefined' ? navigator.language : ''
  return /^en/i.test(lang) ? lang : 'en-GB'
}

/** Reads the steps one after another. Anything already being read is stopped first. */
export function speakSteps(owner: string, steps: readonly string[]): void {
  if (!canSpeak() || steps.length === 0) return
  token++
  const mine = token
  window.speechSynthesis.cancel()
  set({ owner, status: 'speaking', index: 0, total: steps.length, ended: null })

  const next = (i: number) => {
    if (mine !== token) return
    if (i >= steps.length) {
      held.length = 0
      set({ owner, status: 'idle', index: 0, total: steps.length, ended: 'finished' })
      return
    }
    const utterance = new SpeechSynthesisUtterance(steps[i])
    utterance.lang = voiceLanguage()
    utterance.onstart = () => {
      if (mine === token) set({ owner, status: state.status === 'paused' ? 'paused' : 'speaking', index: i, total: steps.length, ended: null })
    }
    utterance.onend = () => next(i + 1)
    utterance.onerror = (event) => {
      if (mine !== token) return
      // "canceled" and "interrupted" come from our own stop; anything else ends the reading.
      if (event.error === 'canceled' || event.error === 'interrupted') return
      held.length = 0
      set({ owner, status: 'idle', index: 0, total: steps.length, ended: 'stopped' })
    }
    held.length = 0
    held.push(utterance)
    set({ owner, status: state.status === 'paused' ? 'paused' : 'speaking', index: i, total: steps.length, ended: null })
    window.speechSynthesis.speak(utterance)
  }
  next(0)
}

export function pauseSpeech(): void {
  if (!canSpeak() || state.status !== 'speaking') return
  window.speechSynthesis.pause()
  set({ ...state, status: 'paused' })
}

export function resumeSpeech(): void {
  if (!canSpeak() || state.status !== 'paused') return
  window.speechSynthesis.resume()
  set({ ...state, status: 'speaking' })
}

export function stopSpeech(): void {
  if (!canSpeak()) return
  token++
  held.length = 0
  window.speechSynthesis.cancel()
  if (state.owner !== null && state.status !== 'idle') set({ ...state, status: 'idle', index: 0, ended: 'stopped' })
}

// ---------- Hearing one request ----------

export type ListenError = 'denied' | 'no_speech' | 'no_microphone' | 'network' | 'other'

interface RecognitionResult {
  0: { transcript: string }
}
interface RecognitionEvent {
  results: ArrayLike<RecognitionResult>
}
interface RecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onspeechend: (() => void) | null
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionConstructor = new () => RecognitionInstance

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function canListen(): boolean {
  return recognitionConstructor() !== null
}

/** The microphone stops by itself after this long without speech. */
const SILENCE_LIMIT_MS = 8000

export interface ListenHandlers {
  onListening: () => void
  /** The person stopped talking and the browser is working out the words. */
  onProcessing: () => void
  onText: (text: string) => void
  onError: (kind: ListenError) => void
  /** Always called last, whatever happened. */
  onEnd: () => void
}

/** Starts the microphone for one request. Returns a function that cancels it. */
export function listenOnce(handlers: ListenHandlers): () => void {
  const Recognition = recognitionConstructor()
  if (!Recognition) {
    handlers.onError('other')
    handlers.onEnd()
    return () => {}
  }
  const recognition = new Recognition()
  recognition.lang = voiceLanguage()
  recognition.continuous = false
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  let gotText = false
  let failed = false
  let cancelled = false
  const timer = setTimeout(() => recognition.stop(), SILENCE_LIMIT_MS)

  recognition.onstart = () => handlers.onListening()
  recognition.onspeechend = () => handlers.onProcessing()
  recognition.onresult = (event) => {
    const text = event.results[0]?.[0]?.transcript ?? ''
    if (text.trim()) {
      gotText = true
      handlers.onText(text)
    }
  }
  recognition.onerror = (event) => {
    if (cancelled || event.error === 'aborted') return
    failed = true
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') handlers.onError('denied')
    else if (event.error === 'no-speech') handlers.onError('no_speech')
    else if (event.error === 'audio-capture') handlers.onError('no_microphone')
    else if (event.error === 'network') handlers.onError('network')
    else handlers.onError('other')
  }
  recognition.onend = () => {
    clearTimeout(timer)
    if (!cancelled && !gotText && !failed) handlers.onError('no_speech')
    handlers.onEnd()
  }
  try {
    recognition.start()
  } catch {
    clearTimeout(timer)
    failed = true
    handlers.onError('other')
    handlers.onEnd()
  }
  return () => {
    cancelled = true
    clearTimeout(timer)
    try {
      recognition.abort()
    } catch {
      // Already stopped.
    }
  }
}
