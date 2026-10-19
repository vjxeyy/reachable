import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { graphFor, loadCampus } from './graph'
import { hardExclusionReason, PROFILES } from './profiles'
import { findRoute, UNVERIFIED_LABEL, type RouteResult } from './route'
import { DECAY_MS } from './trust'
import type { Confirmation, ProfileId, Report } from './types'

// Tests may name ids from the campus fixture. Logic in src/core never does.
const campus = loadCampus(campusData)
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const MIN = 60_000

const HOSTEL_RAMP = 'p-canteen-hostel-ramp'
const GARDEN_WALK = 'p-library-garden'
const HEALTH_RAMP = 'p-lecture-health-ramp'
const ADMIN_STEPS = 'p-admin-library-steps'

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

/** A report an admin verified five minutes ago. */
function verifiedReport(overrides: Partial<Report> & Pick<Report, 'pathId'>): Report {
  return report({ adminVerifiedAt: NOW - 5 * MIN, ...overrides })
}

function route(
  from: string,
  to: string,
  profile: ProfileId = 'wheelchair',
  reports: Report[] = [],
  confirmations: Confirmation[] = [],
  now = NOW,
): RouteResult {
  return findRoute({ campus, reports, confirmations, now }, { from, to, profile })
}

function okRoute(result: RouteResult) {
  if (result.status !== 'ok') throw new Error(`Expected a route, got ${result.status}`)
  return result.route
}

const pathById = graphFor(campus).pathById

describe('campus data', () => {
  it('has about 15 nodes and 25 paths and passes validation', () => {
    expect(campus.nodes.length).toBe(15)
    expect(campus.paths.length).toBeGreaterThanOrEqual(24)
    expect(campus.paths.length).toBeLessThanOrEqual(28)
  })

  it('has a single ramp as the only step-free link into one area (Health Centre)', () => {
    const links = campus.paths.filter((p) => p.from === 'health' || p.to === 'health')
    const stepFree = links.filter((p) => p.stepFree)
    expect(stepFree.map((p) => p.id)).toEqual([HEALTH_RAMP])
    expect(links.length).toBeGreaterThan(1)
  })
})

describe('acceptance checks (PLAN.md section 8)', () => {
  it('1. Wheelchair route never uses a path with stepFree: false', () => {
    const scenarios: Report[][] = [[], [verifiedReport({ pathId: HOSTEL_RAMP })], [report({ pathId: HEALTH_RAMP })]]
    let checked = 0
    for (const reports of scenarios) {
      for (const a of campus.nodes) {
        for (const b of campus.nodes) {
          const result = route(a.id, b.id, 'wheelchair', reports)
          const candidate = result.status === 'ok' ? result.route : result.alternative
          if (!candidate) continue
          for (const pathId of candidate.pathIds) expect(pathById.get(pathId)?.stepFree).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('2. Crutches route may use a gentle stepped path that Wheelchair may not', () => {
    const steps = pathById.get(ADMIN_STEPS)!
    expect(steps.stepFree).toBe(false)
    expect(steps.slopePct).toBeLessThanOrEqual(10)

    const crutches = okRoute(route('admin', 'library', 'crutches'))
    const wheelchair = okRoute(route('admin', 'library', 'wheelchair'))
    expect(crutches.pathIds).toEqual([ADMIN_STEPS])
    expect(crutches.stepFree).toBe(false)
    expect(wheelchair.pathIds).not.toContain(ADMIN_STEPS)
    expect(wheelchair.stepFree).toBe(true)
    expect(wheelchair.lengthM).toBeGreaterThan(crutches.lengthM)
  })

  it('3. A verified blocked ramp on the shortest step-free route changes it to a longer step-free route', () => {
    const usual = okRoute(route('library', 'hostel'))
    expect(usual.pathIds).toContain(HOSTEL_RAMP)

    const block = verifiedReport({ pathId: HOSTEL_RAMP })
    const result = route('library', 'hostel', 'wheelchair', [block])
    const rerouted = okRoute(result)
    expect(rerouted.pathIds).not.toContain(HOSTEL_RAMP)
    expect(rerouted.stepFree).toBe(true)
    expect(rerouted.verification).toBe('verified')
    expect(rerouted.lengthM).toBeGreaterThan(usual.lengthM)
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.reroute?.because.map((i) => i.reportId)).toEqual([block.id])
    expect(result.reroute?.extraM).toBe(rerouted.lengthM - usual.lengthM)
  })

  it('4. An unverified block adds a penalty but leaves the path usable when no alternative exists, labelled unverified', () => {
    const usual = okRoute(route('gate', 'health'))
    expect(usual.pathIds).toContain(HEALTH_RAMP)

    const block = report({ pathId: HEALTH_RAMP })
    const result = route('gate', 'health', 'wheelchair', [block])
    expect(result.status).toBe('no_verified_route')
    if (result.status !== 'no_verified_route') throw new Error('unreachable')
    const option = result.alternative
    expect(option).not.toBeNull()
    expect(option!.pathIds).toEqual(usual.pathIds)
    expect(option!.verification).toBe('unverified')
    expect(option!.label).toBe(UNVERIFIED_LABEL)
    expect(option!.cost).toBe(usual.cost + 200)
    expect(option!.unverifiedBlocks.map((i) => i.reportId)).toEqual([block.id])
  })

  it('5. Blocking all step-free links between two places returns no_verified_route', () => {
    const healthBlocked = route('gate', 'health', 'wheelchair', [verifiedReport({ pathId: HEALTH_RAMP })])
    expect(healthBlocked.status).toBe('no_verified_route')
    if (healthBlocked.status !== 'no_verified_route') throw new Error('unreachable')
    expect(healthBlocked.reason).toBe('blocked_by_reports')
    expect(healthBlocked.alternative).toBeNull()
    expect(healthBlocked.message).toBe('No verified step-free route')

    const hostelBlocked = route('library', 'hostel', 'wheelchair', [
      verifiedReport({ pathId: HOSTEL_RAMP }),
      verifiedReport({ pathId: GARDEN_WALK, category: 'flooding' }),
    ])
    expect(hostelBlocked.status).toBe('no_verified_route')
    if (hostelBlocked.status !== 'no_verified_route') throw new Error('unreachable')
    expect(hostelBlocked.alternative).toBeNull()
  })

  it('6. Marking the block cleared restores the original route', () => {
    const original = route('library', 'hostel')
    const block = report({ pathId: HOSTEL_RAMP })
    expect(okRoute(route('library', 'hostel', 'wheelchair', [block])).pathIds).not.toContain(HOSTEL_RAMP)

    const clearedVote: Confirmation = {
      reportId: block.id,
      areaId: campus.areaId,
      voterId: 'device-passer-by',
      vote: 'cleared',
      at: NOW - MIN,
    }
    expect(route('library', 'hostel', 'wheelchair', [block], [clearedVote])).toEqual(original)

    const resolvedByAdmin = verifiedReport({ pathId: HOSTEL_RAMP, clearedAt: NOW - MIN })
    expect(route('library', 'hostel', 'wheelchair', [resolvedByAdmin])).toEqual(original)
  })

  it('7. A report older than its decay time becomes outdated and stops hard-blocking', () => {
    const usual = okRoute(route('library', 'hostel'))
    const seen = NOW - DECAY_MS.blocked_ramp
    const fresh = verifiedReport({ pathId: HOSTEL_RAMP, createdAt: seen, lastConfirmedAt: seen, adminVerifiedAt: seen })
    expect(okRoute(route('library', 'hostel', 'wheelchair', [fresh])).pathIds).not.toContain(HOSTEL_RAMP)

    const stale = { ...fresh, createdAt: seen - 1, lastConfirmedAt: seen - 1, adminVerifiedAt: seen - 1 }
    const result = route('library', 'hostel', 'wheelchair', [stale])
    const back = okRoute(result)
    expect(back.pathIds).toEqual(usual.pathIds)
    expect(back.cost).toBe(usual.cost + 20)
    expect(back.warnings.map((w) => [w.reportId, w.status, w.effect])).toEqual([[stale.id, 'outdated', 'outdated']])
  })

  it('8. Same query with identical data returns the identical route (no randomness)', () => {
    const reports = [
      report({ pathId: HOSTEL_RAMP }),
      verifiedReport({ pathId: 'p-library-quad', category: 'broken_pavement', severity: 'partial' }),
      report({ pathId: 'p-gate-quad', category: 'parked_vehicle', severity: 'partial' }),
    ]
    for (const profile of ['wheelchair', 'crutches', 'low_vision'] as const) {
      for (const [from, to] of [['library', 'hostel'], ['gate', 'health'], ['parking', 'sports']]) {
        const first = route(from, to, profile, reports)
        expect(route(from, to, profile, reports)).toEqual(first)
        expect(route(from, to, profile, structuredClone(reports))).toEqual(first)
        expect(route(from, to, profile, [...reports].reverse())).toEqual(first)
      }
    }
  })
})

describe('demo flow (PLAN.md section 1)', () => {
  it('reroutes, fails safe, then recovers with fresh unverified reports', () => {
    const step1 = okRoute(route('library', 'hostel'))
    expect(step1.stepFree).toBe(true)

    const ramp = report({ id: 'demo-ramp', pathId: HOSTEL_RAMP })
    const step3 = route('library', 'hostel', 'wheelchair', [ramp])
    expect(step3.status).toBe('ok')
    if (step3.status !== 'ok') throw new Error('unreachable')
    expect(step3.route.pathIds).not.toContain(HOSTEL_RAMP)
    expect(step3.route.stepFree).toBe(true)
    expect(step3.reroute?.because.map((i) => i.reportId)).toEqual(['demo-ramp'])

    const secondPath = step3.route.pathIds[0]
    const second = report({ id: 'demo-second', pathId: secondPath, category: 'flooding' })
    const step4 = route('library', 'hostel', 'wheelchair', [ramp, second])
    expect(step4.status).toBe('no_verified_route')
    if (step4.status !== 'no_verified_route') throw new Error('unreachable')
    expect(step4.message).toBe('No verified step-free route')
    expect(step4.alternative?.label).toBe(UNVERIFIED_LABEL)
    expect(step4.blockedBy.map((i) => i.reportId).sort()).toEqual(['demo-ramp', 'demo-second'])

    const cleared: Confirmation = { reportId: 'demo-ramp', areaId: campus.areaId, voterId: 'x', vote: 'cleared', at: NOW }
    const step5 = okRoute(route('library', 'hostel', 'wheelchair', [ramp, second], [cleared]))
    expect(step5.pathIds).toEqual(step1.pathIds)
  })
})

describe('profile rules', () => {
  it('Wheelchair excludes narrow (< 0.9 m) and steep (> 8%) paths', () => {
    for (const a of campus.nodes) {
      for (const b of campus.nodes) {
        const result = route(a.id, b.id, 'wheelchair')
        if (result.status !== 'ok') continue
        for (const pathId of result.route.pathIds) {
          const path = pathById.get(pathId)!
          expect(path.widthM).toBeGreaterThanOrEqual(0.9)
          expect(path.slopePct).toBeLessThanOrEqual(8)
        }
      }
    }
    const workshop = route('lab', 'workshop', 'wheelchair')
    expect(workshop.status).toBe('no_verified_route')
    if (workshop.status !== 'no_verified_route') throw new Error('unreachable')
    expect(workshop.reason).toBe('no_path_for_profile')
    expect(workshop.alternative).toBeNull()
  })

  it('Wheelchair pays +30 on a 5 to 8% slope', () => {
    const r = okRoute(route('canteen', 'hostel'))
    expect(r.pathIds).toEqual([HOSTEL_RAMP])
    expect(r.cost).toBe(pathById.get(HOSTEL_RAMP)!.lengthM + 30)
  })

  it('Crutches excludes slopes over 10% and pays +25 for 6 to 10% and +10 over 150 m', () => {
    const steps = okRoute(route('admin', 'library', 'crutches'))
    expect(steps.cost).toBe(pathById.get(ADMIN_STEPS)!.lengthM + 25 + 10)
    const health = okRoute(route('busstop', 'health', 'crutches'))
    expect(health.pathIds).not.toContain('p-health-busstop-steps')
  })

  it('Low vision pays +20 on paths narrower than 1.5 m', () => {
    const r = okRoute(route('canteen', 'hostel', 'low_vision'))
    expect(r.cost).toBe(pathById.get(HOSTEL_RAMP)!.lengthM + 20)
  })

  it('Partial obstacle: penalty for Wheelchair, treated as blocking for Low vision', () => {
    const partial = report({ pathId: HOSTEL_RAMP, category: 'parked_vehicle', severity: 'partial' })
    const wheelchair = okRoute(route('library', 'hostel', 'wheelchair', [partial]))
    expect(wheelchair.pathIds).toContain(HOSTEL_RAMP)
    expect(wheelchair.warnings.map((w) => w.effect)).toEqual(['partial'])
    expect(wheelchair.cost).toBe(okRoute(route('library', 'hostel')).cost + 60)

    const lowVision = okRoute(route('library', 'hostel', 'low_vision', [partial]))
    expect(lowVision.pathIds).not.toContain(HOSTEL_RAMP)
  })

  it('An unverified block is avoided even when the detour is long', () => {
    const block = report({ pathId: 'p-library-canteen' })
    const r = okRoute(route('library', 'canteen', 'wheelchair', [block]))
    expect(r.pathIds).not.toContain('p-library-canteen')
    expect(r.verification).toBe('verified')
  })

  it('ignores reports from another campus or on unknown paths', () => {
    const elsewhere = verifiedReport({ pathId: HOSTEL_RAMP, areaId: 'other-campus' })
    const unknown = verifiedReport({ pathId: 'no-such-path' })
    expect(route('library', 'hostel', 'wheelchair', [elsewhere, unknown])).toEqual(route('library', 'hostel'))
  })

  it('returns an empty route when start and destination are the same', () => {
    const r = okRoute(route('library', 'library'))
    expect(r.pathIds).toEqual([])
    expect(r.lengthM).toBe(0)
  })

  it('throws on unknown nodes', () => {
    expect(() => route('library', 'nowhere')).toThrow(/Unknown destination/)
  })
})

describe('combined profiles', () => {
  const PROFILE_SETS: ProfileId[][] = [
    ['wheelchair', 'crutches'],
    ['wheelchair', 'low_vision'],
    ['crutches', 'low_vision'],
    ['wheelchair', 'crutches', 'low_vision'],
  ]
  const partial = report({ pathId: HOSTEL_RAMP, category: 'parked_vehicle', severity: 'partial' })
  const SCENARIOS: Report[][] = [
    [],
    [partial],
    [verifiedReport({ pathId: HOSTEL_RAMP })],
    [report({ pathId: 'p-library-canteen' }), partial],
  ]
  const combo = (from: string, to: string, profile: ProfileId[], reports: Report[] = []) =>
    findRoute({ campus, reports, confirmations: [], now: NOW }, { from, to, profile })
  /** The echoed query is what the caller sent, so it is left out when comparing results. */
  const withoutQuery = (r: RouteResult) => ({ ...r, query: undefined })

  it('a one-item list gives exactly the same result as the plain profile for every pair', () => {
    for (const id of ['wheelchair', 'crutches', 'low_vision'] as ProfileId[]) {
      for (const reports of SCENARIOS) {
        for (const a of campus.nodes) {
          for (const b of campus.nodes) {
            expect(withoutQuery(combo(a.id, b.id, [id], reports))).toEqual(
              withoutQuery(route(a.id, b.id, id, reports)),
            )
          }
        }
      }
    }
  })

  it('a combination is never less strict than any of its members', () => {
    for (const set of PROFILE_SETS) {
      for (const reports of SCENARIOS) {
        for (const a of campus.nodes) {
          for (const b of campus.nodes) {
            const combined = combo(a.id, b.id, set, reports)
            if (combined.status !== 'ok') continue
            for (const member of set) {
              // Where the combination finds a verified route, each member could too, and no cheaper.
              const alone = route(a.id, b.id, member, reports)
              expect(alone.status).toBe('ok')
              if (alone.status !== 'ok') continue
              expect(combined.route.cost).toBeGreaterThanOrEqual(alone.route.cost)
              // Every path it uses is allowed for every member.
              for (const pathId of combined.route.pathIds) {
                expect(hardExclusionReason(PROFILES[member], pathById.get(pathId)!)).toBeNull()
              }
            }
          }
        }
      }
    }
  })

  it('wheelchair + low vision pays both sets of penalties on the hostel ramp', () => {
    const r = okRoute(combo('canteen', 'hostel', ['wheelchair', 'low_vision']))
    expect(r.pathIds).toEqual([HOSTEL_RAMP])
    // +30 for the 7% slope (wheelchair) and +20 for the 1.4 m width (low vision).
    expect(r.cost).toBe(pathById.get(HOSTEL_RAMP)!.lengthM + 30 + 20)
  })

  it('wheelchair + low vision treats a partial obstacle as blocking, wheelchair alone does not', () => {
    const alone = okRoute(route('library', 'hostel', 'wheelchair', [partial]))
    expect(alone.pathIds).toContain(HOSTEL_RAMP)
    const both = okRoute(combo('library', 'hostel', ['wheelchair', 'low_vision'], [partial]))
    expect(both.pathIds).not.toContain(HOSTEL_RAMP)
    expect(both.pathIds).toContain(GARDEN_WALK)
    expect(both.verification).toBe('verified')
  })

  it('wheelchair + low vision never uses steps, narrow or steep paths', () => {
    for (const a of campus.nodes) {
      for (const b of campus.nodes) {
        const result = combo(a.id, b.id, ['wheelchair', 'low_vision'])
        if (result.status !== 'ok') continue
        for (const pathId of result.route.pathIds) {
          const path = pathById.get(pathId)!
          expect(path.stepFree).toBe(true)
          expect(path.widthM).toBeGreaterThanOrEqual(0.9)
          expect(path.slopePct).toBeLessThanOrEqual(8)
        }
      }
    }
    // The stepped Admin to Library shortcut is off limits, but the step-free way round works.
    const admin = okRoute(combo('admin', 'library', ['wheelchair', 'low_vision']))
    expect(admin.pathIds).not.toContain(ADMIN_STEPS)
  })

  it('keeps the fail-safe wording and behaviour', () => {
    const blocked = [verifiedReport({ pathId: HEALTH_RAMP })]
    const stepFree = combo('gate', 'health', ['wheelchair', 'low_vision'], blocked)
    expect(stepFree.status).toBe('no_verified_route')
    if (stepFree.status !== 'no_verified_route') throw new Error('unreachable')
    expect(stepFree.message).toBe('No verified step-free route')
    expect(stepFree.alternative).toBeNull()

    const alley = [verifiedReport({ pathId: 'p-lab-workshop-alley' })]
    const other = combo('lab', 'workshop', ['crutches', 'low_vision'], alley)
    expect(other.status).toBe('no_verified_route')
    if (other.status !== 'no_verified_route') throw new Error('unreachable')
    expect(other.message).toBe('No verified route for crutches and low vision')
  })

  it('gives the same result whatever order the profiles are ticked in', () => {
    for (const a of campus.nodes) {
      for (const b of campus.nodes) {
        expect(withoutQuery(combo(a.id, b.id, ['low_vision', 'wheelchair'], [partial]))).toEqual(
          withoutQuery(combo(a.id, b.id, ['wheelchair', 'low_vision'], [partial])),
        )
      }
    }
  })
})
