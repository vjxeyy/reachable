// The voice guide's conversation: ask for the start, confirm it, ask for the destination, confirm it, find the route,
// read it one step at a time, and take spoken commands. A state machine: the same state and the same words always
// give the same reply. Pure: no DOM, no network. Routes come from the existing engine through `ctx.find`; the
// words come from the existing `directionsFor`. Nothing here invents a turn, a distance, a time or a landmark.

import type { RouteResult } from '../core/route'
import type { Campus } from '../core/types'
import { interpret, type Command } from './commands'
import { directionsFor, reportText } from './directions'
import type { LiveChange } from './liveUpdate'
import { parsePlace, parseRoute } from './parseRoute'

export type Phase =
  | 'ask_start'
  | 'confirm_start'
  | 'ask_destination'
  | 'confirm_destination'
  | 'guiding'
  | 'paused'
  | 'done'
  | 'no_route'
  | 'offer_new'

export interface GuideState {
  phase: Phase
  /** Confirmed start and destination (node ids), '' until confirmed. */
  from: string
  to: string
  /** A place heard and waiting for "yes". */
  pending: string
  /** A destination heard in the same breath as the start ("from hostel to canteen"), asked about next. */
  queuedTo: string
  /** Answers in a row that were not understood in this question. */
  misses: number
  /** Windows in a row with no speech. */
  silences: number
  /** The spoken route, and the next step to read. */
  steps: string[]
  stepIndex: number
}

export interface GuideContext {
  campus: Campus
  now: number
  /** The existing route engine, for the Low vision profile. */
  find(from: string, to: string): RouteResult
}

/** After speaking: wait for an answer, wait a moment between steps, or do not listen at all. */
export type Listen = 'question' | 'window' | 'none'

export interface Turn {
  state: GuideState
  say: string[]
  listen: Listen
  /** `stop_speech` happens before the lines, `return_to_map` after them. */
  effect?: 'stop_speech' | 'return_to_map'
  /** Set when a route was worked out in this turn. */
  result?: RouteResult
}

const FRESH: GuideState = { phase: 'ask_start', from: '', to: '', pending: '', queuedTo: '', misses: 0, silences: 0, steps: [], stepIndex: 0 }

const name = (campus: Campus, id: string) => campus.nodes.find((n) => n.id === id)?.name ?? id
const placesLine = (campus: Campus) => `The places I know are: ${campus.nodes.map((n) => n.name).join(', ')}.`

const ASK_START = 'Where are you now? Say the name of your starting place.'
const ASK_DESTINATION = 'Where do you want to go? Say the name of your destination.'
const NO_ROUTE_OPTIONS = 'Say change start, change destination, or start over.'
const DONE_PROMPT = 'That was the last step. Say repeat to hear a step again, start over for a new trip, or return to map.'

function prompt(s: GuideState, ctx: GuideContext): string {
  switch (s.phase) {
    case 'ask_start':
      return ASK_START
    case 'ask_destination':
      return ASK_DESTINATION
    case 'confirm_start':
      return `I heard ${name(ctx.campus, s.pending)} as your start. Is that right? Say yes or no.`
    case 'confirm_destination':
      return `I heard ${name(ctx.campus, s.pending)} as your destination. Is that right? Say yes or no.`
    case 'paused':
      return 'Paused. Say resume to continue, repeat, start over, or return to map.'
    case 'done':
      return DONE_PROMPT
    case 'no_route':
      return NO_ROUTE_OPTIONS
    case 'offer_new':
      return 'Say yes to hear the new directions, or no to wait.'
    case 'guiding':
      return 'Say repeat, next, pause, stop, change destination, start over, or return to map.'
  }
}

function helpText(s: GuideState): string {
  if (s.phase === 'guiding') {
    return 'While I read directions you can say repeat, next, pause, stop, change start, change destination, start over, or return to map. I listen for a moment after each step.'
  }
  if (s.phase === 'ask_start' || s.phase === 'ask_destination' || s.phase === 'confirm_start' || s.phase === 'confirm_destination') {
    return 'You can say a place name, yes, no, repeat, places, change start, change destination, start over, or return to map.'
  }
  return 'You can say repeat, resume, pause, stop, change start, change destination, start over, or return to map.'
}

const isQuestion = (p: Phase) => p === 'ask_start' || p === 'ask_destination' || p === 'confirm_start' || p === 'confirm_destination'

function turn(state: GuideState, say: string[], listen: Listen, extra: Partial<Turn> = {}): Turn {
  return { state, say, listen, ...extra }
}

// ---------- Starting ----------

/** The first turn: why the microphone is needed, then the first question. */
export function begin(ctx: GuideContext): Turn {
  void ctx
  return turn({ ...FRESH }, [
    'Welcome to the REACHABLE voice guide.',
    'I will use your microphone only to hear your answers. Please choose Allow if your browser asks.',
    'You can say help at any time, or return to map to leave.',
    ASK_START,
  ], 'question')
}

// ---------- Routes ----------

function buildSteps(ctx: GuideContext, from: string, to: string, result: Extract<RouteResult, { status: 'ok' }>): string[] {
  return [
    `Route found from ${name(ctx.campus, from)} to ${name(ctx.campus, to)}. The map data has no travel times, so I cannot give a time estimate.`,
    ...directionsFor(ctx.campus, result.route, { now: ctx.now, reroute: result.reroute }),
  ]
}

function readFirst(s: GuideState, steps: string[]): Turn {
  return turn({ ...s, phase: 'guiding', steps, stepIndex: Math.min(2, steps.length), misses: 0, silences: 0 }, steps.slice(0, 2), 'window')
}

function noRouteLines(ctx: GuideContext, result: Extract<RouteResult, { status: 'no_verified_route' }>, from: string, to: string): string[] {
  const lines = [
    `I could not find a safe route from ${name(ctx.campus, from)} to ${name(ctx.campus, to)} for low vision.`,
    result.message.replace(/\s+/g, ' ').trim(),
  ]
  const blockers = result.blockedBy.slice(0, 3)
  if (blockers.length > 0) lines.push(`Blocked by: ${blockers.map((b) => reportText(ctx.campus, b, ctx.now)).join('; ')}.`)
  return lines.map((l) => (/[.!?]$/.test(l) ? l : `${l}.`))
}

function findAndStart(s: GuideState, ctx: GuideContext): Turn {
  const result = ctx.find(s.from, s.to)
  if (result.status === 'ok') {
    const steps = buildSteps(ctx, s.from, s.to, result)
    return { ...readFirst(s, steps), result }
  }
  const next: GuideState = { ...s, phase: 'no_route', steps: [], stepIndex: 0, pending: '', queuedTo: '', misses: 0, silences: 0 }
  return turn(next, [...noRouteLines(ctx, result, s.from, s.to), NO_ROUTE_OPTIONS], 'question', { result })
}

function advance(s: GuideState, ctx: GuideContext): Turn {
  void ctx
  if (s.stepIndex < s.steps.length) {
    return turn({ ...s, stepIndex: s.stepIndex + 1, silences: 0 }, [s.steps[s.stepIndex]], 'window')
  }
  return turn({ ...s, phase: 'done', silences: 0 }, [DONE_PROMPT], 'question')
}

// ---------- What was said ----------

/** What the person said, as a turn. */
export function onHeard(state: GuideState, spoken: string, ctx: GuideContext): Turn {
  const s: GuideState = { ...state, silences: 0 }
  const heard = interpret(spoken)
  return 'command' in heard ? onCommand(s, heard.command, ctx) : onText(s, heard.text, ctx)
}

function onCommand(s: GuideState, command: Command, ctx: GuideContext): Turn {
  switch (command) {
    case 'return_to_map':
      return turn(s, ['Returning to the map.'], 'none', { effect: 'return_to_map' })

    case 'stop':
      // Speech is cut off at once. While reading, the reading also holds until the person says resume.
      return turn(s.phase === 'guiding' ? { ...s, phase: 'paused' } : s, [], 'question', { effect: 'stop_speech' })

    case 'start_over':
      return turn({ ...FRESH }, ['Starting over.', ASK_START], 'question')

    case 'help':
      return turn(s, [helpText(s), ...(isQuestion(s.phase) ? [prompt(s, ctx)] : [])], s.phase === 'guiding' ? 'window' : 'question')

    case 'places':
      return turn(s, [placesLine(ctx.campus), ...(isQuestion(s.phase) ? [prompt(s, ctx)] : [])], s.phase === 'guiding' ? 'window' : 'question')

    case 'repeat':
      return onRepeat(s, ctx)

    case 'change_start':
      return turn({ ...s, phase: 'ask_start', from: '', pending: '', queuedTo: '', steps: [], stepIndex: 0, misses: 0 }, ['Okay.', ASK_START], 'question')

    case 'change_destination':
      return turn({ ...s, phase: 'ask_destination', to: '', pending: '', queuedTo: '', steps: [], stepIndex: 0, misses: 0 }, ['Okay.', ASK_DESTINATION], 'question')

    case 'change':
      return turn(s, ['Do you want to change the start or the destination? Say change start or change destination.'], 'question')

    case 'pause':
      if (s.phase === 'guiding') return turn({ ...s, phase: 'paused' }, ['Paused. Say resume to continue.'], 'question')
      return turn(s, [s.phase === 'paused' ? prompt(s, ctx) : `There is nothing to pause. ${prompt(s, ctx)}`], 'question')

    case 'resume':
      if (s.phase === 'paused') return resume(s, ctx)
      if (s.phase === 'guiding') return turn(s, [], 'window')
      return turn(s, [`There is nothing to resume. ${prompt(s, ctx)}`], 'question')

    case 'next':
      if (s.phase === 'guiding' || s.phase === 'paused') return advance({ ...s, phase: 'guiding' }, ctx)
      return turn(s, [prompt(s, ctx)], 'question')

    case 'yes':
      return onYes(s, ctx)

    case 'no':
      return onNo(s, ctx)
  }
}

function resume(s: GuideState, ctx: GuideContext): Turn {
  const next = advance({ ...s, phase: 'guiding' }, ctx)
  return next.state.phase === 'done' ? next : { ...next, say: ['Resuming.', ...next.say] }
}

function onRepeat(s: GuideState, ctx: GuideContext): Turn {
  if (s.phase === 'guiding' || s.phase === 'paused') {
    const last = s.steps[Math.max(0, s.stepIndex - 1)]
    return turn(s, last ? [last] : [prompt(s, ctx)], s.phase === 'guiding' ? 'window' : 'question')
  }
  if (s.phase === 'done') return turn(s, [...(s.steps.length > 0 ? [s.steps[s.steps.length - 1]] : []), DONE_PROMPT], 'question')
  return turn(s, [prompt(s, ctx)], 'question')
}

function onYes(s: GuideState, ctx: GuideContext): Turn {
  if (s.phase === 'confirm_start') {
    const set: GuideState = { ...s, from: s.pending, pending: '', misses: 0 }
    if (s.queuedTo && s.queuedTo !== set.from) {
      const next: GuideState = { ...set, phase: 'confirm_destination', pending: s.queuedTo, queuedTo: '' }
      return turn(next, [`Start set to ${name(ctx.campus, set.from)}.`, `I also heard ${name(ctx.campus, s.queuedTo)} as your destination. Is that right? Say yes or no.`], 'question')
    }
    if (set.to) return findAndStart({ ...set, queuedTo: '' }, ctx)
    return turn({ ...set, phase: 'ask_destination', queuedTo: '' }, [`Start set to ${name(ctx.campus, set.from)}.`, ASK_DESTINATION], 'question')
  }
  if (s.phase === 'confirm_destination') {
    return findAndStart({ ...s, to: s.pending, pending: '', misses: 0 }, ctx)
  }
  if (s.phase === 'offer_new') return readFirst(s, s.steps)
  if (s.phase === 'guiding') return turn(s, [], 'window')
  return turn(s, [`I was not asking a question. ${prompt(s, ctx)}`], 'question')
}

function onNo(s: GuideState, ctx: GuideContext): Turn {
  if (s.phase === 'confirm_start') return turn({ ...s, phase: 'ask_start', pending: '', queuedTo: '', misses: 0 }, ['Okay.', ASK_START], 'question')
  if (s.phase === 'confirm_destination') return turn({ ...s, phase: 'ask_destination', pending: '', misses: 0 }, ['Okay.', ASK_DESTINATION], 'question')
  if (s.phase === 'offer_new') return turn({ ...s, phase: 'paused', stepIndex: 0 }, ['Okay. Say resume when you want to hear the new directions.'], 'question')
  if (s.phase === 'guiding') return turn(s, [], 'window')
  return turn(s, [`I was not asking a question. ${prompt(s, ctx)}`], 'question')
}

function onText(s: GuideState, text: string, ctx: GuideContext): Turn {
  if (s.phase === 'ask_start' || s.phase === 'ask_destination') return onPlace(s, text, ctx)
  if (s.phase === 'confirm_start' || s.phase === 'confirm_destination') {
    return turn({ ...s, misses: s.misses + 1 }, ['Please say yes or no.', prompt(s, ctx)], 'question')
  }
  return turn(s, ['Sorry, I did not understand. Say help to hear what you can say.'], s.phase === 'guiding' ? 'window' : 'question')
}

function onPlace(s: GuideState, text: string, ctx: GuideContext): Turn {
  const asking = s.phase === 'ask_start'
  const both = parseRoute(text, ctx.campus)
  // "From hostel to canteen" answers both questions at once. Each is still confirmed aloud.
  if (both.from && both.to && both.problems.length === 0) {
    if (asking) return turn({ ...s, phase: 'confirm_start', pending: both.from, queuedTo: both.to, misses: 0 }, [prompt({ ...s, phase: 'confirm_start', pending: both.from }, ctx)], 'question')
    return confirmDestination(s, both.to, ctx)
  }
  const match = parsePlace(text, ctx.campus)
  if ('id' in match) {
    if (asking) return turn({ ...s, phase: 'confirm_start', pending: match.id, queuedTo: '', misses: 0 }, [prompt({ ...s, phase: 'confirm_start', pending: match.id }, ctx)], 'question')
    return confirmDestination(s, match.id, ctx)
  }
  const misses = s.misses + 1
  return turn({ ...s, misses }, [match.problem, misses >= 2 ? placesLine(ctx.campus) : 'Please say the place name again.'], 'question')
}

function confirmDestination(s: GuideState, id: string, ctx: GuideContext): Turn {
  if (id === s.from) {
    return turn({ ...s, misses: s.misses + 1 }, [`That is where you are starting. Please say a different destination.`], 'question')
  }
  const next: GuideState = { ...s, phase: 'confirm_destination', pending: id, misses: 0 }
  return turn(next, [prompt(next, ctx)], 'question')
}

// ---------- Silence, waking, live changes ----------

const GIVE_UP_AFTER = 6

function giveUp(s: GuideState): Turn {
  return turn({ ...s, silences: 0 }, ['I will stop listening now. Press any key or tap the screen when you want to continue.'], 'none')
}

/** No speech was heard in a listening window. */
export function onSilence(state: GuideState, ctx: GuideContext): Turn {
  if (state.phase === 'guiding') return advance(state, ctx)
  const silences = state.silences + 1
  const s: GuideState = { ...state, silences }
  if (silences >= GIVE_UP_AFTER) return giveUp(s)
  if (isQuestion(s.phase)) {
    return turn(s, ['I did not hear you.', ...(silences % 3 === 0 ? [helpText(s)] : []), prompt(s, ctx)], 'question')
  }
  return turn(s, silences % 3 === 0 ? [prompt(s, ctx)] : [], 'question')
}

/** A key or tap after the guide stopped listening: ask again. */
export function onWake(state: GuideState, ctx: GuideContext): Turn {
  const s: GuideState = { ...state, silences: 0 }
  if (s.phase === 'guiding') return onRepeat(s, ctx)
  return turn(s, [prompt(s, ctx)], 'question')
}

/** Reports changed the route being followed (see `describeChange`). Null when there is no route to follow. */
export function onRouteChange(state: GuideState, change: LiveChange, ctx: GuideContext): Turn | null {
  if (!state.from || !state.to || isQuestion(state.phase)) return null
  const base: GuideState = { ...state, pending: '', queuedTo: '', misses: 0, silences: 0 }
  if (change.result.status === 'ok') {
    const steps = buildSteps(ctx, state.from, state.to, change.result)
    return turn({ ...base, phase: 'offer_new', steps, stepIndex: 0 }, [...change.lines, prompt({ ...base, phase: 'offer_new' }, ctx)], 'question', {
      effect: 'stop_speech',
      result: change.result,
    })
  }
  return turn({ ...base, phase: 'no_route', steps: [], stepIndex: 0 }, [...change.lines, NO_ROUTE_OPTIONS], 'question', {
    effect: 'stop_speech',
    result: change.result,
  })
}
