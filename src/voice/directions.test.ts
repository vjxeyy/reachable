import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { findRoute, type RouteResult } from '../core/route'
import type { Report } from '../core/types'
import { directionsFor, spokenDistance, speakable } from './directions'

const campus = loadCampus(campusData)
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const MIN = 60_000

const HOSTEL_RAMP = 'p-canteen-hostel-ramp'
const HEALTH_RAMP = 'p-lecture-health-ramp'

let nextId = 1
function report(overrides: Partial<Report> & Pick<Report, 'pathId'>): Report {
  return {
    id: `v${nextId++}`,
    areaId: campus.areaId,
    category: 'blocked_ramp',
    severity: 'blocked',
    status: 'unverified',
    confidence: 0.8,
    aiCategory: 'blocked_ramp',
    photoUrl: null,
    description: '',
    reporterId: 'device-reporter',
    createdAt: NOW - 5 * MIN,
    lastConfirmedAt: NOW - 5 * MIN,
    clearedAt: null,
    adminVerifiedAt: null,
    ...overrides,
  }
}

function find(from: string, to: string, profile: Parameters<typeof findRoute>[1]['profile'], reports: Report[] = []): RouteResult {
  return findRoute({ campus, reports, confirmations: [], now: NOW }, { from, to, profile })
}

function steps(result: RouteResult, which: 'route' | 'partial' | 'unverified' = 'route'): string[] {
  if (result.status === 'ok') return directionsFor(campus, result.route, { now: NOW, reroute: result.reroute })
  const route = which === 'partial' ? result.partialOption : result.alternative
  if (!route) throw new Error('No such option')
  return directionsFor(campus, route, { now: NOW })
}

describe('directionsFor: a plain route', () => {
  const result = find('library', 'hostel', 'wheelchair')
  const spoken = steps(result)

  it('opens with the kind of route, the distance and whether it suits the person', () => {
    expect(spoken[0]).toMatch(/^Step-free route.*, \d+ metres\./)
    expect(spoken[0]).toMatch(/for Wheelchair/)
  })

  it('has one step per leg, naming the places, and ends with the arrival', () => {
    if (result.status !== 'ok') throw new Error('unreachable')
    const legSteps = spoken.filter((s) => /^Step \d+ of \d+\./.test(s))
    expect(legSteps).toHaveLength(result.route.legs.length)
    expect(legSteps[0]).toMatch(/^Step 1 of \d+\. From Library to /)
    expect(spoken[spoken.length - 1]).toBe('You have arrived at Hostel. Conditions change, so check on site.')
  })

  it('says what is hard on a leg: slope and narrow width', () => {
    // The hostel ramp is 7% and 1.4 m wide.
    const ramp = steps(find('canteen', 'hostel', 'wheelchair')).find((s) => /^Step 1 of \d+\. From Canteen to Hostel/.test(s))!
    expect(ramp).toMatch(/A ramp, with a 7 percent slope\./)
    expect(ramp).toMatch(/Narrow, 1\.4 metres wide\./)
  })

  it('says "Has steps" for a stepped path that crutches may use', () => {
    const stepped = steps(find('admin', 'library', 'crutches')).join(' ')
    expect(stepped).toMatch(/Has steps\./)
  })

  it('says it is already there for a zero length route', () => {
    expect(steps(find('library', 'library', 'wheelchair'))).toEqual(['You are already at Library.'])
  })
})

describe('directionsFor: what the reports change', () => {
  it('reads out a report on a leg, with its status and age, and the reroute reason', () => {
    const reports = [report({ pathId: HOSTEL_RAMP })]
    const result = find('library', 'hostel', 'wheelchair', reports)
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.reroute).not.toBeNull()
    const spoken = directionsFor(campus, result.route, { now: NOW, reroute: result.reroute })
    const rerouted = spoken.find((s) => s.startsWith('Rerouted'))!
    expect(rerouted).toMatch(/longer than usual, to avoid Blocked ramp on Canteen to Hostel ramp, reported as blocked, unverified, reported 5 minutes ago\./)
  })

  it('reads a partial report found on the route, as a report made here', () => {
    const reports = [report({ pathId: HEALTH_RAMP, category: 'parked_vehicle', severity: 'partial' })]
    const spoken = steps(find('gate', 'health', 'wheelchair', reports))
    const onLeg = spoken.find((s) => /Reported here:/.test(s))!
    expect(onLeg).toMatch(/Reported here: Parked vehicle on Lecture Halls to Health Centre ramp, reported as partly blocked, unverified, reported 5 minutes ago\./)
  })

  it('says a partly blocked option is not a verified route and that it is not advised for low vision', () => {
    const reports = [report({ pathId: HEALTH_RAMP, category: 'parked_vehicle', severity: 'partial', adminVerifiedAt: NOW - MIN })]
    const result = find('gate', 'health', ['wheelchair', 'low_vision'], reports)
    expect(result.status).toBe('no_verified_route')
    const spoken = steps(result, 'partial')
    expect(spoken[0]).toMatch(/^Partly blocked, use with caution, \d+ metres\. This is not a verified route\./)
    expect(spoken[0]).toMatch(/Not advised for Wheelchair and low vision on its own\./)
    expect(spoken.join(' ')).toMatch(/Take care\./)
  })

  it('says an unverified option is not a verified route', () => {
    const reports = [report({ pathId: HOSTEL_RAMP, adminVerifiedAt: NOW - MIN }), report({ pathId: 'p-library-garden' })]
    const result = find('library', 'hostel', 'wheelchair', reports)
    expect(result.status).toBe('no_verified_route')
    if (result.status !== 'no_verified_route' || !result.alternative) throw new Error('unreachable')
    expect(steps(result, 'unverified')[0]).toMatch(/^Unverified, use with caution, \d+ metres\. This is not a verified route\./)
  })
})

describe('directionsFor: wording rules', () => {
  const samples = [
    steps(find('library', 'hostel', 'wheelchair')),
    steps(find('admin', 'library', 'crutches')),
    steps(find('gate', 'health', ['wheelchair', 'low_vision'], [report({ pathId: HEALTH_RAMP, category: 'parked_vehicle', severity: 'partial', adminVerifiedAt: NOW - MIN })]), 'partial'),
  ]

  it('never calls a route accessible', () => {
    for (const spoken of samples) expect(spoken.join(' ')).not.toMatch(/accessible/i)
  })

  it('has no dash characters, no unit symbols and no percent signs, so a voice reads it cleanly', () => {
    for (const spoken of samples) {
      const text = spoken.join(' ')
      expect(text).not.toMatch(/[–—·%]/)
      expect(text).not.toMatch(/\d\s?m\b(?!etre)/)
    }
  })

  it('gives the same steps for the same input', () => {
    expect(steps(find('library', 'hostel', 'wheelchair'))).toEqual(steps(find('library', 'hostel', 'wheelchair')))
  })
})

describe('spoken helpers', () => {
  it('says distances in words', () => {
    expect(spokenDistance(120)).toBe('120 metres')
    expect(spokenDistance(1)).toBe('1 metre')
    expect(spokenDistance(1250)).toBe('1.25 kilometres')
  })

  it('turns written units into words', () => {
    expect(speakable('Library to Canteen: steep for this profile, 7% against a limit of 8%.')).toBe('Library to Canteen: steep for this profile, 7 percent against a limit of 8 percent.')
    expect(speakable('tight, 1.4 m wide against a 0.9 m minimum.')).toBe('tight, 1.4 metres wide against a 0.9 metres minimum.')
    expect(speakable('120 m · steps')).toBe('120 metres, steps')
  })
})
