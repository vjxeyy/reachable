import { useEffect, useRef } from 'react'
import { MapIcon, MicIcon } from '../components/icons'
import { setExperience } from '../state/experience'
import { unlockSpeech } from '../voice/speech'

/**
 * The first choice: how will you use REACHABLE? The voice guide is first and has the focus, so a screen reader or
 * keyboard user lands on it. The tap on it is also what lets the browser speak and use the microphone.
 */
export function Welcome() {
  const voice = useRef<HTMLButtonElement>(null)
  useEffect(() => voice.current?.focus(), [])

  return (
    <div className="welcome">
      <h1>How will you use REACHABLE?</h1>
      <p className="muted">Know before you go. You can change this later. You choose; the site does not guess.</p>
      <div className="welcome-choices">
        <button
          ref={voice}
          type="button"
          className="btn welcome-choice"
          onClick={() => {
            unlockSpeech()
            window.location.hash = '#/voice'
          }}
        >
          <MicIcon size={28} />
          <span>
            <strong>Blind or low vision</strong>
            <span className="welcome-sub">Voice guide. It speaks to you and listens for your answers.</span>
          </span>
        </button>
        <button
          type="button"
          className="btn btn-ghost welcome-choice"
          onClick={() => {
            setExperience('map')
            window.location.hash = '#/'
          }}
        >
          <MapIcon size={28} />
          <span>
            <strong>Campus map</strong>
            <span className="welcome-sub">The map, route finder and live reports.</span>
          </span>
        </button>
      </div>
    </div>
  )
}
