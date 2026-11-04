import { useEffect, useRef, useState } from 'react'
import type { Campus } from '../core/types'
import { parseRoute } from '../voice/parseRoute'
import { canListen, listenOnce, type ListenError } from '../voice/speech'
import { MicIcon } from './icons'
import { StopSelect } from './StopSelect'

type Phase =
  | { name: 'idle' }
  | { name: 'listening' }
  | { name: 'processing' }
  | { name: 'review'; heard: string; from: string; to: string; problems: string[] }
  | { name: 'done'; text: string }
  | { name: 'error'; message: string }

const ERROR_TEXT: Record<ListenError, string> = {
  denied: 'The microphone is blocked. Allow it for this site in your browser settings, or use the lists above.',
  no_speech: 'I did not hear anything. Press the button and try again, or use the lists above.',
  no_microphone: 'No microphone was found. Use the lists above.',
  network: 'The browser could not reach its speech service. Try again, or use the lists above.',
  other: 'Voice input did not work this time. Try again, or use the lists above.',
}

interface Props {
  campus: Campus
  /** The places now in the route fields, kept when the person names only one of them. */
  from: string
  to: string
  /** Called only when the person presses "Use these". */
  onApply: (from: string, to: string) => void
}

const placeName = (campus: Campus, id: string) => campus.nodes.find((n) => n.id === id)?.name ?? id

/**
 * Speak a route: "From hostel to canteen". What was heard is shown in words, the understood places can be
 * changed, and nothing reaches the route fields until the person presses "Use these".
 * Without speech recognition (or without permission) the lists above keep working.
 */
export function VoiceRoute({ campus, from, to, onApply }: Props) {
  const supported = canListen()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const cancel = useRef<(() => void) | null>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)

  // Stop the microphone if the panel goes away.
  useEffect(() => () => cancel.current?.(), [])
  // Move keyboard and screen reader focus to the review when it appears.
  useEffect(() => {
    if (phase.name === 'review') reviewHeading.current?.focus()
  }, [phase.name])

  if (!supported) {
    return <p className="voice-note muted small">Voice input is not available in this browser. Use the lists above.</p>
  }

  function start() {
    cancel.current?.()
    setPhase({ name: 'listening' })
    let answered = false
    cancel.current = listenOnce({
      onListening: () => setPhase({ name: 'listening' }),
      onProcessing: () => setPhase((p) => (p.name === 'listening' ? { name: 'processing' } : p)),
      onText: (text) => {
        answered = true
        const parsed = parseRoute(text, campus)
        // A place the person did not name ("take me to the library") keeps what is in the route field now.
        // A place they named but that was not understood stays empty, so it is never replaced behind their back.
        const keep = parsed.problems.length === 0
        setPhase({
          name: 'review',
          heard: parsed.heard,
          from: parsed.from || (keep ? from : ''),
          to: parsed.to || (keep ? to : ''),
          problems: parsed.problems,
        })
      },
      onError: (kind) => {
        if (!answered) setPhase({ name: 'error', message: ERROR_TEXT[kind] })
      },
      onEnd: () => {
        cancel.current = null
        setPhase((p) => (p.name === 'listening' || p.name === 'processing' ? { name: 'idle' } : p))
      },
    })
  }

  function stop() {
    cancel.current?.()
    cancel.current = null
    setPhase({ name: 'idle' })
  }

  const busy = phase.name === 'listening' || phase.name === 'processing'
  const statusText =
    phase.name === 'listening'
      ? 'Listening. Say, for example, "from Hostel to Canteen".'
      : phase.name === 'processing'
        ? 'Working out what you said.'
        : phase.name === 'review'
          ? 'Understood. Check the places below, then press Use these.'
          : phase.name === 'done'
            ? phase.text
            : phase.name === 'error'
              ? phase.message
              : ''

  return (
    <div className="voice-route">
      <div className="voice-row">
        <button
          type="button"
          className="btn btn-ghost voice-btn"
          onClick={busy ? stop : start}
          aria-label={busy ? 'Stop listening' : undefined}
        >
          <MicIcon />
          {busy ? 'Stop listening' : phase.name === 'error' ? 'Try again' : 'Speak a route'}
        </button>
        <span className="muted small voice-hint">Say "from Hostel to Canteen".</span>
      </div>
      <p className="voice-status small" role="status">
        {statusText}
      </p>

      {phase.name === 'review' && (
        <div className="voice-review">
          <h3 ref={reviewHeading} tabIndex={-1} className="voice-review-title">
            You said: "{phase.heard}"
          </h3>
          {phase.problems.length > 0 && (
            <ul className="voice-problems">
              {phase.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="voice-pickers">
            <StopSelect label="From" placeholder="Choose start" value={phase.from} campus={campus} onPick={(id) => setPhase({ ...phase, from: id })} />
            <StopSelect label="To" placeholder="Choose destination" value={phase.to} campus={campus} onPick={(id) => setPhase({ ...phase, to: id })} />
          </div>
          {phase.from !== '' && phase.from === phase.to && <p className="voice-problems small">The start and the destination are the same place.</p>}
          <div className="voice-actions">
            <button
              type="button"
              className="btn"
              disabled={phase.from === '' || phase.to === '' || phase.from === phase.to}
              onClick={() => {
                onApply(phase.from, phase.to)
                setPhase({ name: 'done', text: `Route set from ${placeName(campus, phase.from)} to ${placeName(campus, phase.to)}.` })
              }}
            >
              Use these
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setPhase({ name: 'idle' })}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className="voice-note muted small">The microphone is on only after you press the button. Your browser may send what you say to its speech service.</p>
    </div>
  )
}
