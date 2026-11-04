import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { findRoute } from '../core/route'
import type { Report } from '../core/types'
import { begin, onHeard, onRouteChange, onSilence, onWake, type GuideContext, type GuideState, type Turn } from './guide'

const campus = loadCampus(campusData)
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const MIN = 60_000

function makeCtx(reports: Report[] = []): GuideContext {
  return {
    campus,
    now: NOW,
    find: (from, to) => findRoute({ campus, reports, confirmations: [], now: NOW }, { from, to, profile: ['low_vision'] }),
  }
}
const ctx = makeCtx()

/** Plays a list of spoken answers and returns the last turn. */
function play(said: string[], context: GuideContext = ctx): Turn {
  let turn = begin(context)
  for (const text of said) turn = onHeard(turn.state, text, context)
  return turn
}
const spoken = (turn: Turn) => turn.say.join(' ')

function blockedReport(pathId: string): Report {
  return {
    id: `r-${pathId}`,
    areaId: campus.areaId,
    pathId,
    category: 'blocked_ramp',
    severity: 'blocked',
    status: 'unverified',
    confidence: 0.9,
    aiCategory: 'blocked_ramp',
    photoUrl: null,
    description: '',
    reporterId: 'device-a',
    createdAt: NOW - 5 * MIN,
    lastConfirmedAt: NOW - 5 * MIN,
    clearedAt: null,
    adminVerifiedAt: NOW - MIN,
  }
}

describe('the conversation', () => {
  it('starts by saying why the microphone is needed, then asks for the start', () => {
    const turn = begin(ctx)
    expect(turn.state.phase).toBe('ask_start')
    expect(turn.listen).toBe('question')
    expect(spoken(turn)).toMatch(/microphone only to hear your answers/)
    expect(turn.say[turn.say.length - 1]).toMatch(/starting place/)
  })

  it('asks for the start, reads it back, asks for the destination, reads it back, then finds the route', () => {
    let turn = play(['Hostel'])
    expect(turn.state.phase).toBe('confirm_start')
    expect(spoken(turn)).toBe('I heard Hostel as your start. Is that right? Say yes or no.')

    turn = onHeard(turn.state, 'yes', ctx)
    expect(turn.state).toMatchObject({ phase: 'ask_destination', from: 'hostel' })
    expect(spoken(turn)).toMatch(/Start set to Hostel\. Where do you want to go\?/)

    turn = onHeard(turn.state, 'the canteen', ctx)
    expect(turn.state.phase).toBe('confirm_destination')
    expect(spoken(turn)).toBe('I heard Canteen as your destination. Is that right? Say yes or no.')

    turn = onHeard(turn.state, 'yes', ctx)
    expect(turn.state).toMatchObject({ phase: 'guiding', from: 'hostel', to: 'canteen' })
    expect(turn.result?.status).toBe('ok')
    expect(turn.listen).toBe('window')
    expect(turn.say[0]).toBe('Route found from Hostel to Canteen. The map data has no travel times, so I cannot give a time estimate.')
    expect(turn.say[1]).toMatch(/metres/)
  })

  it('uses the Low vision engine and never calls a route accessible', () => {
    const turn = play(['hostel', 'yes', 'canteen', 'yes'])
    const all = [...turn.state.steps].join(' ')
    expect(all).not.toMatch(/accessible/i)
    expect(turn.result?.status === 'ok' && turn.result.query.profile).toEqual(['low_vision'])
  })

  it('takes both places said together, and still confirms each one', () => {
    let turn = play(['from hostel to canteen'])
    expect(turn.state).toMatchObject({ phase: 'confirm_start', pending: 'hostel', queuedTo: 'canteen' })
    turn = onHeard(turn.state, 'yes', ctx)
    expect(turn.state).toMatchObject({ phase: 'confirm_destination', from: 'hostel', pending: 'canteen' })
    expect(spoken(turn)).toMatch(/I also heard Canteen as your destination/)
    turn = onHeard(turn.state, 'yes', ctx)
    expect(turn.state.phase).toBe('guiding')
  })

  it('corrects a wrong answer with "no", and reasks', () => {
    let turn = play(['library', 'no'])
    expect(turn.state).toMatchObject({ phase: 'ask_start', pending: '' })
    expect(spoken(turn)).toMatch(/Where are you now\?/)
    turn = play(['library', 'yes', 'canteen', 'no'])
    expect(turn.state).toMatchObject({ phase: 'ask_destination', from: 'library' })
  })

  it('repeats the current question on "repeat" in every question phase', () => {
    for (const said of [[], ['library'], ['library', 'yes'], ['library', 'yes', 'canteen']]) {
      const before = play(said)
      const again = onHeard(before.state, 'repeat', ctx)
      expect(again.state.phase).toBe(before.state.phase)
      expect(spoken(again)).toBe(before.say[before.say.length - 1])
    }
  })

  it('changes the start or the destination by voice and keeps the other answer', () => {
    const route = play(['hostel', 'yes', 'canteen', 'yes'])
    let turn = onHeard(route.state, 'change start', ctx)
    expect(turn.state).toMatchObject({ phase: 'ask_start', from: '', to: 'canteen' })
    turn = onHeard(turn.state, 'library', ctx)
    turn = onHeard(turn.state, 'yes', ctx)
    expect(turn.state).toMatchObject({ phase: 'guiding', from: 'library', to: 'canteen' })

    turn = onHeard(route.state, 'change destination', ctx)
    expect(turn.state).toMatchObject({ phase: 'ask_destination', from: 'hostel', to: '' })
    turn = onHeard(turn.state, 'lab block', ctx)
    turn = onHeard(turn.state, 'yes', ctx)
    expect(turn.state).toMatchObject({ phase: 'guiding', from: 'hostel', to: 'lab' })
  })

  it('asks which one to change when only "change" is said', () => {
    const turn = play(['change'])
    expect(spoken(turn)).toMatch(/change start or change destination/)
  })

  it('starts over from the beginning', () => {
    const turn = onHeard(play(['hostel', 'yes', 'canteen', 'yes']).state, 'start over', ctx)
    expect(turn.state).toMatchObject({ phase: 'ask_start', from: '', to: '' })
    expect(spoken(turn)).toMatch(/Starting over\./)
  })

  it('says why a place was not understood, and lists the places after the second miss', () => {
    let turn = play(['the moon'])
    expect(spoken(turn)).toMatch(/I did not recognise "moon" as a place\. Please say the place name again\./)
    expect(turn.state.phase).toBe('ask_start')
    turn = onHeard(turn.state, 'mars', ctx)
    expect(spoken(turn)).toMatch(/The places I know are: Main Gate, Parking/)
  })

  it('does not guess between two places', () => {
    const turn = play(['block'])
    expect(turn.state.phase).toBe('ask_start')
    expect(spoken(turn)).toMatch(/could be Admin Block or Lab Block/)
  })

  it('asks for a yes or no when something else is said at a confirmation', () => {
    const turn = play(['hostel', 'banana'])
    expect(turn.state.phase).toBe('confirm_start')
    expect(spoken(turn)).toMatch(/Please say yes or no\./)
  })

  it('does not accept the start as the destination', () => {
    const turn = play(['hostel', 'yes', 'hostel'])
    expect(turn.state.phase).toBe('ask_destination')
    expect(spoken(turn)).toMatch(/different destination/)
  })

  it('lists the places on request and gives help', () => {
    expect(spoken(play(['places']))).toMatch(/The places I know are/)
    expect(spoken(play(['help']))).toMatch(/return to map/)
  })

  it('leaves for the map on "return to map" after saying so', () => {
    const turn = play(['return to map'])
    expect(turn.effect).toBe('return_to_map')
    expect(turn.listen).toBe('none')
    expect(spoken(turn)).toMatch(/Returning to the map/)
  })
})

describe('reading the directions', () => {
  const route = play(['hostel', 'yes', 'canteen', 'yes'])
  const steps = route.state.steps

  it('reads the first two lines at once, then one step per quiet window, then finishes', () => {
    let turn = route
    expect(route.state.stepIndex).toBe(2)
    const read: string[] = [...route.say]
    while (turn.state.phase === 'guiding') {
      turn = onSilence(turn.state, ctx)
      if (turn.state.phase === 'guiding') read.push(...turn.say)
    }
    expect(read).toEqual(steps)
    expect(turn.state.phase).toBe('done')
    expect(spoken(turn)).toMatch(/That was the last step/)
  })

  it('every spoken step comes from the route data: no invented time or landmark', () => {
    for (const step of steps.slice(1)) expect(step).not.toMatch(/minute|hour|turn left|turn right|landmark/i)
  })

  it('repeats the step just read', () => {
    const turn = onHeard(onSilence(route.state, ctx).state, 'repeat', ctx)
    expect(turn.say).toEqual([steps[2]])
    expect(turn.state.stepIndex).toBe(3)
  })

  it('pauses, holds the place, and resumes where it left off', () => {
    const afterOne = onSilence(route.state, ctx)
    const paused = onHeard(afterOne.state, 'pause', ctx)
    expect(paused.state.phase).toBe('paused')
    expect(onSilence(paused.state, ctx).say).toEqual([])
    const resumed = onHeard(paused.state, 'resume', ctx)
    expect(resumed.state.phase).toBe('guiding')
    expect(resumed.say).toEqual(['Resuming.', steps[3]])
  })

  it('stops speech at once and holds the reading until resume', () => {
    const stopped = onHeard(route.state, 'stop', ctx)
    expect(stopped.effect).toBe('stop_speech')
    expect(stopped.say).toEqual([])
    expect(stopped.state.phase).toBe('paused')
    expect(stopped.listen).toBe('question')
  })

  it('skips ahead on "next"', () => {
    const turn = onHeard(route.state, 'next', ctx)
    expect(turn.say).toEqual([steps[2]])
  })

  it('says it was not asking a question when yes is said to a step, and keeps reading', () => {
    const turn = onHeard(route.state, 'yes', ctx)
    expect(turn.say).toEqual([])
    expect(turn.state.phase).toBe('guiding')
  })

  it('wakes with the right line after it stopped listening', () => {
    expect(spoken(onWake(play(['hostel']).state, ctx))).toMatch(/I heard Hostel as your start/)
  })
})

describe('silence and unclear speech', () => {
  it('reasks a question after silence, adds the commands after three, then stops listening', () => {
    let turn = begin(ctx)
    turn = onSilence(turn.state, ctx)
    expect(spoken(turn)).toMatch(/^I did not hear you\. Where are you now\?/)
    turn = onSilence(turn.state, ctx)
    turn = onSilence(turn.state, ctx)
    expect(spoken(turn)).toMatch(/You can say a place name/)
    for (let i = 0; i < 3; i++) turn = onSilence(turn.state, ctx)
    expect(turn.listen).toBe('none')
    expect(spoken(turn)).toMatch(/Press any key or tap the screen/)
  })

  it('treats a heard answer as ending the silence count', () => {
    let turn = onSilence(onSilence(begin(ctx).state, ctx).state, ctx)
    expect(turn.state.silences).toBe(2)
    turn = onHeard(turn.state, 'hostel', ctx)
    expect(turn.state.silences).toBe(0)
  })
})

describe('no safe route, and live changes', () => {
  const blockAll = [blockedReport('p-canteen-hostel-ramp'), blockedReport('p-garden-hostel'), blockedReport('p-hostel-sports-steps')]

  it('says clearly when no safe route exists, and offers what to change', () => {
    const blocked = makeCtx(blockAll)
    const turn = play(['hostel', 'yes', 'canteen', 'yes'], blocked)
    expect(turn.state.phase).toBe('no_route')
    expect(turn.listen).toBe('question')
    const text = spoken(turn)
    expect(text).toMatch(/I could not find a safe route from Hostel to Canteen for low vision\./)
    expect(text).toMatch(/Blocked by:/)
    expect(text).toMatch(/Say change start, change destination, or start over\./)
    expect(text).not.toMatch(/Route found/)
  })

  it('offers new directions after the route changes, and reads them on yes', () => {
    const followed = play(['hostel', 'yes', 'canteen', 'yes'])
    const reports = [blockedReport('p-canteen-hostel-ramp')]
    const after = makeCtx(reports).find('hostel', 'canteen')
    const live = onRouteChange(followed.state, { lines: ['Alert. Something.'], result: after }, makeCtx(reports))
    expect(live).not.toBeNull()
    expect(live!.effect).toBe('stop_speech')
    expect(live!.state.phase).toBe('offer_new')
    expect(spoken(live!)).toMatch(/Alert\. Something\. Say yes to hear the new directions/)
    const yes = onHeard(live!.state, 'yes', ctx)
    expect(yes.state.phase).toBe('guiding')
    expect(yes.say[0]).toMatch(/^Route found from Hostel to Canteen/)
    const no = onHeard(live!.state, 'no', ctx)
    expect(no.state).toMatchObject({ phase: 'paused', stepIndex: 0 })
  })

  it('says there is no safe route when the change leaves none', () => {
    const followed = play(['hostel', 'yes', 'canteen', 'yes'])
    const blocked = makeCtx(blockAll)
    const after = blocked.find('hostel', 'canteen')
    const live = onRouteChange(followed.state, { lines: ['There is no safe suitable route now.'], result: after }, blocked)
    expect(live!.state.phase).toBe('no_route')
    expect(spoken(live!)).toMatch(/no safe suitable route/)
  })

  it('ignores live changes while it is still asking the questions', () => {
    const asking = play(['hostel']).state
    expect(onRouteChange(asking, { lines: [], result: ctx.find('hostel', 'canteen') }, ctx)).toBeNull()
  })
})

describe('every start and destination, by voice', () => {
  it('finds the same route as the route engine for all 210 pairs', () => {
    let checked = 0
    for (const a of campus.nodes) {
      for (const b of campus.nodes) {
        if (a.id === b.id) continue
        const turn = play([a.name, 'yes', b.name, 'yes'])
        const expected = ctx.find(a.id, b.id)
        const state: GuideState = turn.state
        expect([a.id, b.id, state.from, state.to]).toEqual([a.id, b.id, a.id, b.id])
        expect(state.phase, `${a.name} to ${b.name}`).toBe(expected.status === 'ok' ? 'guiding' : 'no_route')
        expect(turn.result).toEqual(expected)
        checked++
      }
    }
    expect(checked).toBe(210)
  })
})
