import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { findRoute, type RouteResult } from '../core/route'
import { withDerivedStatus } from '../core/trust'
import type { Report } from '../core/types'
import { describeChange, outcomeKey } from './liveUpdate'

const campus = loadCampus(campusData)
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const MIN = 60_000

let nextId = 1
function report(overrides: Partial<Report> & Pick<Report, 'pathId'>): Report {
  return {
    id: `r${nextId++}`,
    areaId: campus.areaId,
    category: 'blocked_ramp',
    severity: 'blocked',
    status: 'unverified',
    confidence: 0.8,
    aiCategory: 'blocked_ramp',
    photoUrl: null,
    description: '',
    reporterId: 'device-reporter',
    createdAt: NOW - 10 * MIN,
    lastConfirmedAt: NOW - 10 * MIN,
    clearedAt: null,
    adminVerifiedAt: null,
    ...overrides,
  }
}

const verified = (overrides: Partial<Report> & Pick<Report, 'pathId'>) => report({ adminVerifiedAt: NOW - 5 * MIN, ...overrides })

function find(reports: Report[], from = 'hostel', to = 'canteen'): RouteResult {
  return findRoute({ campus, reports, confirmations: [], now: NOW }, { from, to, profile: ['low_vision'] })
}
const derived = (reports: Report[]) => withDerivedStatus(reports, [], NOW)

function change(beforeReports: Report[], afterReports: Report[], from = 'hostel', to = 'canteen') {
  return describeChange({
    campus,
    before: find(beforeReports, from, to),
    after: find(afterReports, from, to),
    beforeReports: derived(beforeReports),
    afterReports: derived(afterReports),
    now: NOW,
  })
}

describe('describeChange: obstacles that affect the route', () => {
  it('says nothing when nothing changed, or when a report is on a road the route does not use', () => {
    expect(change([], [])).toBeNull()
    expect(change([], [verified({ pathId: 'p-gate-busstop' })])).toBeNull()
  })

  it('announces a verified block on the route, names its status, and says the recalculated route', () => {
    const result = change([], [verified({ pathId: 'p-canteen-hostel-ramp' })])
    expect(result).not.toBeNull()
    const text = result!.lines.join(' ')
    expect(result!.lines[0]).toMatch(/^Alert\./)
    expect(text).toMatch(/blocked ramp/i)
    expect(text).toMatch(/reported as blocked, verified/i)
    expect(text).toMatch(/I have recalculated\. The new route is \d+ metres\. That is \d+ metres longer than before\./)
    expect(result!.result.status).toBe('ok')
  })

  it('says the report is unverified when it is', () => {
    const result = change([], [report({ pathId: 'p-canteen-hostel-ramp' })])
    expect(result!.lines.join(' ')).toMatch(/reported as blocked, unverified/i)
  })

  it('says clearly when no safe suitable route is left', () => {
    const blockAll = [verified({ pathId: 'p-canteen-hostel-ramp' }), verified({ pathId: 'p-garden-hostel' }), verified({ pathId: 'p-hostel-sports-steps' })]
    const result = change([], blockAll)
    expect(result!.result.status).toBe('no_verified_route')
    const text = result!.lines.join(' ')
    expect(text).toMatch(/There is no safe suitable route from Hostel to Canteen now\./)
    expect(text).toMatch(/Blocked by:/)
    expect(text).not.toMatch(/recalculated/)
  })

  it('announces a cleared report that opens a route again', () => {
    const blockAll = [verified({ pathId: 'p-canteen-hostel-ramp' }), verified({ pathId: 'p-garden-hostel' }), verified({ pathId: 'p-hostel-sports-steps' })]
    const reopened = [verified({ pathId: 'p-canteen-hostel-ramp', clearedAt: NOW, id: blockAll[0].id }), blockAll[1]]
    const result = change(blockAll, reopened)
    expect(result!.lines[0]).toMatch(/^Update\./)
    expect(result!.lines.join(' ')).toMatch(/A route is available now, \d+ metres\./)
  })

  it('is the same every time and never mentions a travel time', () => {
    const a = change([], [verified({ pathId: 'p-canteen-hostel-ramp' })])
    const b = change([], [verified({ pathId: 'p-canteen-hostel-ramp' })])
    expect(a!.lines.length).toBe(b!.lines.length)
    expect(a!.lines).toEqual(b!.lines)
    expect(a!.lines.join(' ')).not.toMatch(/to walk|walking time|will take/i)
  })
})

describe('outcomeKey', () => {
  it('differs when the route differs and matches when it does not', () => {
    const base = outcomeKey(find([]))
    expect(outcomeKey(find([]))).toBe(base)
    expect(outcomeKey(find([verified({ pathId: 'p-canteen-hostel-ramp' })]))).not.toBe(base)
  })
})
