import { useEffect, useRef, useState } from 'react'
import { findRoute, type RouteResult } from '../core/route'
import { withDerivedStatus } from '../core/trust'
import type { Confirmation, Report } from '../core/types'
import { campus, setSelection, useNow, useStore } from '../state/store'
import { begin, onHeard, onRouteChange, onSilence, onWake, type GuideContext, type GuideState, type Listen, type Turn } from '../voice/guide'
import { describeChange } from '../voice/liveUpdate'
import { canListen, canSpeak, listenOnce, say, stopNow, unlockSpeech, type ListenError } from '../voice/speech'

type Mode = 'running' | 'gesture' | 'waiting' | 'failed' | 'unsupported'

interface Inputs {
  reports: Report[]
  confirmations: Confirmation[]
  now: number
}

interface Io {
  inputs: () => Inputs
  show: (line: string) => void
  status: (text: string) => void
  mode: (mode: Mode) => void
  leave: () => void
}

const FAILURE: Record<'denied' | 'no_microphone' | 'network' | 'other', string> = {
  denied:
    'I cannot hear you because the microphone is blocked. To allow it, open the site settings in your browser, set the microphone to Allow, then press any key or tap the screen to try again.',
  no_microphone: 'I could not find a microphone. Connect one, then press any key or tap the screen to try again.',
  network: 'Your browser could not reach its speech service. Press any key or tap the screen to try again.',
  other: 'Voice input did not work this time. Press any key or tap the screen to try again.',
}

const UNSUPPORTED =
  'Voice answers do not work in this browser. Please open REACHABLE in Chrome, Edge or Safari, or choose the campus map.'

/**
 * Runs the spoken conversation. Everything it says and decides comes from `src/voice/guide.ts` and the existing
 * route engine; this only speaks, listens and watches the reports. One line is spoken at a time, and the
 * microphone is on only while an answer or a command is expected.
 */
function createSession(io: Io) {
  let alive = true
  let run = 0
  let state: GuideState | null = null
  let baseline: { result: RouteResult; reports: Report[] } | null = null
  let cancelListen: (() => void) | null = null
  let idle: 'gesture' | 'retry' | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const derived = () => {
    const { reports, confirmations, now } = io.inputs()
    return withDerivedStatus(reports, confirmations, now)
  }

  const context = (): GuideContext => {
    const { reports, confirmations, now } = io.inputs()
    return {
      campus,
      now,
      find: (from, to) => findRoute({ campus, reports, confirmations, now }, { from, to, profile: ['low_vision'] }),
    }
  }

  async function perform(turn: Turn): Promise<void> {
    const mine = ++run
    cancelListen?.()
    cancelListen = null
    idle = null
    clearTimeout(retryTimer)
    state = turn.state
    if (turn.effect === 'stop_speech') stopNow()
    if (!state.from || !state.to) baseline = null
    if (turn.result) {
      baseline = { result: turn.result, reports: derived() }
      setSelection({ profiles: ['low_vision'], from: state.from, to: state.to })
    }
    io.mode('running')
    for (const line of turn.say) {
      if (!alive || mine !== run) return
      io.show(line)
      io.status('Speaking')
      await say(line)
    }
    if (!alive || mine !== run) return
    if (turn.effect === 'return_to_map') {
      io.leave()
      return
    }
    if (turn.listen === 'none') {
      idle = 'retry'
      io.mode('waiting')
      io.status('Not listening. Press any key or tap the screen to continue.')
      return
    }
    listen(turn.listen, mine)
  }

  function listen(kind: Listen, mine: number): void {
    io.status(kind === 'question' ? 'Listening for your answer' : 'Listening for a command')
    const got: { text: string | null; error: ListenError | null } = { text: null, error: null }
    cancelListen = listenOnce(
      {
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
          if (!alive || mine !== run || !state) return
          if (got.text !== null) void perform(onHeard(state, got.text, context()))
          else if (got.error === 'denied' || got.error === 'no_microphone' || got.error === 'network' || got.error === 'other') void fail(got.error)
          else void perform(onSilence(state, context()))
        },
      },
      { silenceMs: kind === 'window' ? 2500 : 8000 },
    )
  }

  async function fail(kind: keyof typeof FAILURE): Promise<void> {
    const mine = ++run
    idle = 'retry'
    io.mode('failed')
    io.status('Microphone unavailable')
    io.show(FAILURE[kind])
    await say(FAILURE[kind])
    // One automatic retry after a pause, in case the person fixed the setting meanwhile.
    if (alive && mine === run) retryTimer = setTimeout(wake, 15_000)
  }

  function start(): void {
    void perform(begin(context()))
  }

  /** A key or a tap: begins the guide, or asks again after it stopped listening. */
  function wake(): void {
    if (!alive || idle === null) return
    clearTimeout(retryTimer)
    if (idle === 'gesture') {
      unlockSpeech()
      idle = null
      start()
    } else if (state) {
      void perform(onWake(state, context()))
    } else {
      start()
    }
  }

  function init(): void {
    if (!canListen()) {
      io.mode('unsupported')
      io.show(UNSUPPORTED)
      io.status('Voice answers are not available')
      if (canSpeak()) void say(UNSUPPORTED)
      return
    }
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    if (activation && !activation.hasBeenActive) {
      // Opened by address, with no earlier tap: browsers keep speech silent until one.
      idle = 'gesture'
      io.mode('gesture')
      io.show('Press any key or tap the screen to begin.')
      io.status('Waiting for a key or a tap')
      return
    }
    start()
  }

  /** Reports changed: say so only if the route being followed is affected. */
  function live(): void {
    if (!alive || !baseline || !state || !state.from || !state.to) return
    const ctx = context()
    const after = ctx.find(state.from, state.to)
    const afterReports = derived()
    const change = describeChange({
      campus,
      before: baseline.result,
      after,
      beforeReports: baseline.reports,
      afterReports,
      now: ctx.now,
    })
    if (!change) {
      baseline = { result: after, reports: afterReports }
      return
    }
    const turn = onRouteChange(state, change, ctx)
    if (turn) void perform(turn)
  }

  function dispose(): void {
    alive = false
    run++
    clearTimeout(retryTimer)
    cancelListen?.()
    stopNow()
  }

  return { init, wake, live, dispose }
}

/**
 * The voice-led screen for blind and low-vision users. It shows only a title, the line being spoken and what it is
 * doing, in words. There are no buttons, fields or menus: the conversation is spoken. Escape, or saying "return to
 * map", goes back to the campus map. The one link below appears only when voice cannot work at all.
 */
export function VoiceGuide() {
  const { reports, confirmations } = useStore()
  const now = useNow()
  const inputs = useRef<Inputs>({ reports, confirmations, now })
  const session = useRef<ReturnType<typeof createSession> | null>(null)
  const [line, setLine] = useState('')
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState<Mode>('running')

  useEffect(() => {
    inputs.current = { reports, confirmations, now }
    session.current?.live()
  }, [reports, confirmations, now])

  useEffect(() => {
    const leave = () => {
      window.location.hash = '#/map'
    }
    const s = createSession({ inputs: () => inputs.current, show: setLine, status: setStatus, mode: setMode, leave })
    session.current = s
    s.init()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        s.dispose()
        leave()
      } else s.wake()
    }
    const onPointer = () => s.wake()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
      s.dispose()
      session.current = null
    }
  }, [])

  return (
    <main className="voice-guide" aria-labelledby="voice-guide-title">
      <h1 id="voice-guide-title">REACHABLE voice guide</h1>
      <p className="voice-guide-line" role="status" aria-live="polite">
        {line}
      </p>
      <p className="voice-guide-status">{status}</p>
      {(mode === 'unsupported' || mode === 'failed') && (
        <p className="voice-guide-exit">
          <a href="#/map">Open the campus map</a>
        </p>
      )}
    </main>
  )
}
