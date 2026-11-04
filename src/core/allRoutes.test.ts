// Exhaustive check: every start and destination, for every combination of profiles.
// 15 places give 210 ordered pairs, and the three profiles give 7 non-empty combinations, so 1470 routes.
// Each route is compared with an independent shortest-path calculation (Floyd-Warshall), and the
// same sweep is repeated with a block on every single path. Tests may name ids from the campus fixture.

import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { directionsFor } from '../voice/directions'
import { graphFor, loadCampus } from './graph'
import { combineProfiles, hardExclusionReason, profilePenalty } from './profiles'
import { findRoute, type Route, type RouteResult } from './route'
import { PROFILE_IDS, type ProfileId, type Report } from './types'

const campus = loadCampus(campusData)
const graph = graphFor(campus)
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const MIN = 60_000
const ids = campus.nodes.map((n) => n.id)
const PAIRS = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b] as const))

/** Every non-empty combination of profiles, in the app's fixed order. */
const COMBOS: ProfileId[][] = Array.from({ length: 2 ** PROFILE_IDS.length - 1 }, (_, i) => i + 1).map((mask) =>
  PROFILE_IDS.filter((_, bit) => (mask >> bit) & 1),
)
const comboName = (c: ProfileId[]) => c.join('+')

let nextId = 1
function report(pathId: string, overrides: Partial<Report> = {}): Report {
  return {
    id: `all${nextId++}`,
    areaId: campus.areaId,
    pathId,
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

function find(from: string, to: string, combo: ProfileId[], reports: Report[] = []): RouteResult {
  return findRoute({ campus, reports, confirmations: [], now: NOW }, { from, to, profile: combo })
}

/** Cheapest cost between every pair of places, using only the allowed paths. Infinity when there is none. */
function oracle(combo: ProfileId[], without: ReadonlySet<string> = new Set()): Map<string, number> {
  const profile = combineProfiles(combo)
  const index = new Map(ids.map((id, i) => [id, i]))
  const n = ids.length
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)))
  for (const path of campus.paths) {
    if (without.has(path.id) || hardExclusionReason(profile, path) !== null) continue
    const cost = path.lengthM + profilePenalty(profile, path)
    const a = index.get(path.from)!
    const b = index.get(path.to)!
    d[a][b] = Math.min(d[a][b], cost)
    d[b][a] = Math.min(d[b][a], cost)
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j]
  const out = new Map<string, number>()
  for (const a of ids) for (const b of ids) out.set(`${a}>${b}`, d[index.get(a)!][index.get(b)!])
  return out
}

/** The route is one connected chain of real paths from start to destination. */
function expectConnected(route: Route, from: string, to: string) {
  expect(route.nodeIds[0]).toBe(from)
  expect(route.nodeIds[route.nodeIds.length - 1]).toBe(to)
  expect(route.legs).toHaveLength(route.pathIds.length)
  expect(route.nodeIds).toHaveLength(route.pathIds.length + 1)
  route.legs.forEach((leg, i) => {
    const path = graph.pathById.get(leg.pathId)!
    expect(path).toBeDefined()
    expect([leg.from, leg.to]).toEqual([route.nodeIds[i], route.nodeIds[i + 1]])
    expect(new Set([path.from, path.to])).toEqual(new Set([leg.from, leg.to]))
    expect(leg.lengthM).toBe(path.lengthM)
  })
  expect(route.lengthM).toBe(route.legs.reduce((sum, l) => sum + l.lengthM, 0))
  // No place is visited twice, so there is no loop.
  expect(new Set(route.nodeIds).size).toBe(route.nodeIds.length)
}

describe('every route for every profile combination (no reports)', () => {
  it('covers 210 pairs and 7 combinations', () => {
    expect(PAIRS).toHaveLength(210)
    expect(COMBOS.map(comboName)).toEqual([
      'wheelchair',
      'crutches',
      'wheelchair+crutches',
      'low_vision',
      'wheelchair+low_vision',
      'crutches+low_vision',
      'wheelchair+crutches+low_vision',
    ])
  })

  for (const combo of COMBOS) {
    it(`${comboName(combo)}: all 210 routes agree with an independent shortest-path calculation`, () => {
      const profile = combineProfiles(combo)
      const best = oracle(combo)
      let reachable = 0
      const unreachable: string[] = []

      for (const [from, to] of PAIRS) {
        const result = find(from, to, combo)
        const expected = best.get(`${from}>${to}`)!

        if (expected === Infinity) {
          unreachable.push(`${from}>${to}`)
          expect(result.status, `${from} to ${to}`).toBe('no_verified_route')
          if (result.status !== 'no_verified_route') throw new Error('unreachable')
          expect(result.reason).toBe('no_path_for_profile')
          expect(result.alternative).toBeNull()
          expect(result.partialOption).toBeNull()
          continue
        }

        reachable++
        expect(result.status, `${from} to ${to}`).toBe('ok')
        if (result.status !== 'ok') throw new Error('unreachable')
        const { route } = result
        expectConnected(route, from, to)
        expect(route.cost, `${from} to ${to}`).toBeCloseTo(expected, 6)
        expect(route.verification).toBe('verified')
        expect(result.reroute).toBeNull()
        expect(route.warnings).toEqual([])

        // Hard rules: no path the profile cannot use, and the step-free flag is honest.
        for (const leg of route.legs) expect(hardExclusionReason(profile, graph.pathById.get(leg.pathId)!)).toBeNull()
        expect(route.stepFree).toBe(route.legs.every((l) => graph.pathById.get(l.pathId)!.stepFree))
        if (profile.requireStepFree) expect(route.stepFree).toBe(true)

        // Same question, same answer, and the way back costs the same.
        expect(find(from, to, combo)).toEqual(result)
        const back = find(to, from, combo)
        expect(back.status).toBe('ok')
        if (back.status === 'ok') expect(back.route.cost).toBeCloseTo(route.cost, 6)

        // The fit check and the spoken directions exist and follow the wording rules.
        expect(['good', 'caution', 'not_advised']).toContain(route.fit.verdict)
        const spoken = directionsFor(campus, route, { now: NOW, reroute: result.reroute })
        const text = spoken.join(' ')
        // An opening, one step per leg, the arrival, and a "Take care" step when the fit check has warnings.
        expect(spoken.length).toBe(route.legs.length + 2 + (route.fit.notes.some((n) => n.level === 'warn') ? 1 : 0))
        expect(text).not.toMatch(/accessible/i)
        expect(text).not.toMatch(/[–—·%]/)
        expect(spoken[spoken.length - 1]).toBe(`You have arrived at ${graph.nodeById.get(to)!.name}. Conditions change, so check on site.`)
      }
      console.log(`${comboName(combo).padEnd(31)} ${String(reachable).padStart(3)} of 210 routes found; none: ${unreachable.length === 0 ? '-' : unreachable.join(', ')}`)
    })
  }

  it('a stricter combination never makes a route cheaper or a missing route appear', () => {
    for (const small of COMBOS) {
      for (const big of COMBOS) {
        if (small === big || !small.every((p) => big.includes(p))) continue
        for (const [from, to] of PAIRS) {
          const a = find(from, to, small)
          const b = find(from, to, big)
          if (a.status !== 'ok') {
            expect(b.status, `${comboName(big)} ${from}>${to} cannot beat ${comboName(small)}`).toBe('no_verified_route')
          } else if (b.status === 'ok') {
            expect(b.route.cost).toBeGreaterThanOrEqual(a.route.cost - 1e-9)
          }
        }
      }
    }
  })
})

describe('a block on every single path, for every profile combination and every route', () => {
  it('a verified block is never crossed, and a path that was not used changes nothing', () => {
    for (const combo of COMBOS) {
      const baseline = new Map(PAIRS.map(([a, b]) => [`${a}>${b}`, find(a, b, combo)]))
      for (const path of campus.paths) {
        const blocked = oracle(combo, new Set([path.id]))
        const reports = [report(path.id, { adminVerifiedAt: NOW - 5 * MIN })]
        for (const [from, to] of PAIRS) {
          const before = baseline.get(`${from}>${to}`)!
          const result = find(from, to, combo, reports)
          const label = `${comboName(combo)} ${from}>${to} with ${path.id} blocked`
          const expected = blocked.get(`${from}>${to}`)!

          if (expected === Infinity) {
            expect(result.status, label).toBe('no_verified_route')
            if (result.status === 'no_verified_route') {
              // Verified blocks stay excluded: no option may cross the blocked path.
              for (const option of [result.alternative, result.partialOption]) if (option) expect(option.pathIds, label).not.toContain(path.id)
            }
            continue
          }
          expect(result.status, label).toBe('ok')
          if (result.status !== 'ok') throw new Error('unreachable')
          expectConnected(result.route, from, to)
          expect(result.route.pathIds, label).not.toContain(path.id)
          expect(result.route.cost, label).toBeCloseTo(expected, 6)
          if (before.status === 'ok' && !before.route.pathIds.includes(path.id)) {
            expect(result.route.pathIds, label).toEqual(before.route.pathIds)
            expect(result.reroute, label).toBeNull()
          } else if (before.status === 'ok') {
            expect(result.reroute, label).not.toBeNull()
          }
        }
      }
    }
  }, 120_000)

  it('an unverified block is avoided whenever any other way exists, and is the labelled last resort otherwise', () => {
    for (const combo of COMBOS) {
      for (const path of campus.paths) {
        const blocked = oracle(combo, new Set([path.id]))
        const open = oracle(combo)
        const reports = [report(path.id)]
        for (const [from, to] of PAIRS) {
          const label = `${comboName(combo)} ${from}>${to} with unverified ${path.id}`
          const result = find(from, to, combo, reports)
          if (open.get(`${from}>${to}`) === Infinity) {
            expect(result.status, label).toBe('no_verified_route')
            continue
          }
          if (blocked.get(`${from}>${to}`) !== Infinity) {
            expect(result.status, label).toBe('ok')
            if (result.status === 'ok') expect(result.route.pathIds, label).not.toContain(path.id)
          } else {
            // The only way crosses the unverified block: never shown as the route, offered as an unverified option.
            expect(result.status, label).toBe('no_verified_route')
            if (result.status !== 'no_verified_route') throw new Error('unreachable')
            expect(result.alternative, label).not.toBeNull()
            expect(result.alternative!.verification, label).toBe('unverified')
            expect(result.alternative!.pathIds, label).toContain(path.id)
          }
        }
      }
    }
  }, 120_000)

  it('clearing the block restores the original route for every pair', () => {
    for (const combo of COMBOS) {
      for (const path of campus.paths.slice(0, 8)) {
        const cleared = [report(path.id, { adminVerifiedAt: NOW - 5 * MIN, clearedAt: NOW - MIN })]
        for (const [from, to] of PAIRS) expect(find(from, to, combo, cleared)).toEqual(find(from, to, combo))
      }
    }
  }, 120_000)

  it('a partial report blocks only profiles that count every obstacle as blocking (low vision)', () => {
    for (const combo of COMBOS) {
      const strict = combineProfiles(combo).activeObstacleBlocks
      for (const path of campus.paths) {
        const reports = [report(path.id, { category: 'parked_vehicle', severity: 'partial', adminVerifiedAt: NOW - 5 * MIN })]
        for (const [from, to] of PAIRS) {
          const label = `${comboName(combo)} ${from}>${to} with partial ${path.id}`
          const result = find(from, to, combo, reports)
          if (result.status !== 'ok') continue
          if (strict) expect(result.route.pathIds, label).not.toContain(path.id)
          else if (result.route.pathIds.includes(path.id)) expect(result.route.warnings.map((w) => w.pathId), label).toContain(path.id)
        }
      }
    }
  }, 120_000)
})
