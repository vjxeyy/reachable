import { useEffect, useRef, useState } from 'react'
import { MapIcon, MicIcon } from '../components/icons'
import { interpret } from '../voice/commands'
import { canListen, listenOnce, say, stopNow, unlockSpeech, type ListenError } from '../voice/speech'
import { chooseExperience, type Experience } from '../voice/welcomeChoice'

const CHOICES = 'Say blind or low vision for the voice guide, or say campus map for the map.'
const INTRO = [
  'Welcome to REACHABLE.',
  CHOICES,
  'I will use your microphone only to hear your answer. Please choose Allow if your browser asks.',
]

const FAILURE: Record<ListenError, string> = {
  denied:
    'I cannot hear you because the microphone is blocked. You can still use the buttons, or allow the microphone in your browser settings and press any key or tap the screen to try again.',
  no_microphone: 'I could not find a microphone. You can still use the buttons, or connect one and press any key or tap the screen to try again.',
  network: 'Your browser could not reach its speech service. You can still use the buttons, or press any key or tap the screen to try again.',
  no_speech: '',
  other: 'Voice input did not work this time. You can still use the buttons, or press any key or tap the screen to try again.',
}

const HINT = 'Press any key or tap the screen to hear the choices and answer by voice.'

interface Io {
  show: (line: string) => void
  status: (text: string) => void
}

/**
 * Speaks the two choices and hears the answer. Same rules as the voice guide: one line at a time, the microphone
 * on only while an answer is expected, and silence or a blocked microphone is explained aloud. The buttons keep working.
 */
function createWelcomeVoice(io: Io, go: (choice: Experience) => void) {
  let alive = true
  let run = 0
  let idle = false
  let cancelListen: (() => void) | null = null
  let silences = 0

  async function speak(lines: string[], mine: number): Promise<boolean> {
    for (const line of lines) {
      if (!alive || mine !== run) return false
      io.show(line)
      io.status('Speaking')
      await say(line)
    }
    return alive && mine === run
  }

  async function ask(lines: string[]): Promise<void> {
    const mine = ++run
    cancelListen?.()
    cancelListen = null
    idle = false
    if (await speak(lines, mine)) listen(mine)
  }

  function stopListening(lines: string[]): void {
    const mine = ++run
    idle = true
    void speak(lines, mine).then(() => {
      if (alive && mine === run) io.status('Not listening. Press any key or tap the screen to try again.')
    })
  }

  async function choose(choice: Experience): Promise<void> {
    const mine = ++run
    cancelListen?.()
    cancelListen = null
    if (await speak([choice === 'voice' ? 'Opening the voice guide.' : 'Opening the campus map.'], mine)) go(choice)
  }

  function listen(mine: number): void {
    io.status('Listening for your answer')
    const got: { text: string | null; error: ListenError | null } = { text: null, error: null }
    cancelListen = listenOnce({
      onListening: () => {},
      onProcessing: () => io.status('Working out what you said'),
      onText: (text) => {
        got.text = text
      },
      onError: (error) => {
        got.error = error
      },
      onEnd: () => {
        cancelListen = null
        if (!alive || mine !== run) return
        if (got.text !== null) {
          silences = 0
          const choice = chooseExperience(got.text)
          const heard = interpret(got.text)
          if (choice) void choose(choice)
          else if ('command' in heard && (heard.command === 'repeat' || heard.command === 'help')) void ask([CHOICES])
          else void ask([`Sorry, I did not understand. ${CHOICES}`])
        } else if (got.error && got.error !== 'no_speech') {
          stopListening([FAILURE[got.error]])
        } else {
          silences++
          if (silences >= 3) stopListening(['I will stop listening now. You can still use the buttons, or press any key or tap the screen to try again.'])
          else void ask([`I did not hear you. ${CHOICES}`])
        }
      },
    })
  }

  /** The first key or tap: browsers keep speech and the microphone closed until one. */
  function wake(): void {
    if (!alive || !idle) return
    unlockSpeech()
    silences = 0
    void ask(INTRO)
  }

  function init(): boolean {
    if (!canListen()) return false
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    if (activation && !activation.hasBeenActive) {
      idle = true
      io.show(HINT)
      io.status('Waiting for a key or a tap')
    } else void ask(INTRO)
    return true
  }

  function dispose(): void {
    alive = false
    run++
    cancelListen?.()
    stopNow()
  }

  return { init, wake, dispose }
}

/**
 * The first choice: how will you use REACHABLE? The two buttons work as before, and the page also speaks the choices
 * and hears the answer. The voice guide button is first and has the focus, so a screen reader or keyboard user lands on it.
 */
export function Welcome() {
  const voice = useRef<HTMLButtonElement>(null)
  const [line, setLine] = useState('')
  const [status, setStatus] = useState('')
  const supported = canListen()
  useEffect(() => voice.current?.focus(), [])

  useEffect(() => {
    const go = (choice: Experience) => {
      window.location.hash = choice === 'voice' ? '#/voice' : '#/map'
    }
    const session = createWelcomeVoice({ show: setLine, status: setStatus }, go)
    session.init()
    const wake = () => session.wake()
    window.addEventListener('keydown', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.removeEventListener('keydown', wake)
      window.removeEventListener('pointerdown', wake)
      session.dispose()
    }
  }, [])

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
            window.location.hash = '#/map'
          }}
        >
          <MapIcon size={28} />
          <span>
            <strong>Campus map</strong>
            <span className="welcome-sub">The map, route finder and live reports.</span>
          </span>
        </button>
      </div>
      {supported ? (
        <div className="welcome-voice">
          <p className="welcome-line" role="status" aria-live="polite">
            {line}
          </p>
          <p className="welcome-status muted small">{status}</p>
        </div>
      ) : (
        <p className="muted small">Choosing by voice is not available in this browser. Use the two buttons.</p>
      )}
    </div>
  )
}
