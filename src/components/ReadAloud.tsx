import { useEffect, useMemo } from 'react'
import type { Reroute, Route } from '../core/route'
import type { Campus } from '../core/types'
import { useSpeech } from '../state/voice'
import { directionsFor } from '../voice/directions'
import { canSpeak, getSpeakState, pauseSpeech, resumeSpeech, speakSteps, stopSpeech } from '../voice/speech'
import { PauseIcon, PlayIcon, SpeakerIcon, StopIcon } from './icons'

interface Props {
  campus: Campus
  route: Route
  reroute?: Reroute | null
  now: number
  /** Names this set of directions, so only its own controls show the playing state. */
  ownerKey: string
}

/**
 * Read directions aloud, with pause, resume and stop. While reading, the steps are listed on screen with the
 * current one marked "Now reading", so the directions never depend on sound alone.
 */
export function ReadAloud({ campus, route, reroute, now, ownerKey }: Props) {
  const speech = useSpeech()
  const steps = useMemo(() => directionsFor(campus, route, { now, reroute }), [campus, route, reroute, now])

  // Stop reading when these directions are replaced or leave the page, so old directions are never read out.
  useEffect(() => {
    return () => {
      if (getSpeakState().owner === ownerKey) stopSpeech()
    }
  }, [ownerKey])

  if (!canSpeak()) {
    return <p className="muted small read-note">Reading aloud is not available in this browser.</p>
  }

  const mine = speech.owner === ownerKey
  const active = mine && speech.status !== 'idle'
  const status = !mine
    ? ''
    : speech.status === 'speaking'
      ? `Reading directions aloud, step ${speech.index + 1} of ${speech.total}.`
      : speech.status === 'paused'
        ? `Paused at step ${speech.index + 1} of ${speech.total}.`
        : speech.ended === 'finished'
          ? 'Finished reading.'
          : speech.ended === 'stopped'
            ? 'Stopped.'
            : ''

  return (
    <div className="read-aloud">
      <div className="read-controls">
        {!active && (
          <button type="button" className="btn btn-ghost voice-btn" onClick={() => speakSteps(ownerKey, steps)}>
            <SpeakerIcon />
            Read directions aloud
          </button>
        )}
        {active && speech.status === 'speaking' && (
          <button type="button" className="btn btn-ghost voice-btn" onClick={pauseSpeech}>
            <PauseIcon />
            Pause
          </button>
        )}
        {active && speech.status === 'paused' && (
          <button type="button" className="btn btn-ghost voice-btn" onClick={resumeSpeech}>
            <PlayIcon />
            Resume
          </button>
        )}
        {active && (
          <button type="button" className="btn btn-quiet voice-btn" onClick={stopSpeech}>
            <StopIcon />
            Stop
          </button>
        )}
      </div>
      <p className="read-status small" role="status">
        {status}
      </p>
      {active && (
        <ol className="read-steps">
          {steps.map((text, i) => (
            <li key={i} aria-current={i === speech.index ? 'step' : undefined} className={i === speech.index ? 'is-now' : undefined}>
              {i === speech.index && <strong className="now-reading">Now reading: </strong>}
              {text}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
