import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import seedData from '../../data/seed-reports.json'
import { graphFor, loadCampus } from './graph'
import { findRoute } from './route'
import { buildSeed, type SeedFile } from './seed'
import { deriveStatus } from './trust'

const campus = loadCampus(campusData)
const seed = seedData as SeedFile
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const HOUR = 3_600_000

describe('demo seed reports', () => {
  const { reports, confirmations } = buildSeed(seed, NOW)
  const status = (id: string, now = NOW) => deriveStatus(reports.find((r) => r.id === id)!, confirmations, now)

  it('has 3 or 4 reports on real paths of this campus', () => {
    expect(reports.length).toBeGreaterThanOrEqual(3)
    expect(reports.length).toBeLessThanOrEqual(4)
    for (const r of reports) {
      expect(graphFor(campus).pathById.has(r.pathId)).toBe(true)
      expect(r.areaId).toBe(campus.areaId)
    }
  })

  it('starts with a mix of verified and unverified reports', () => {
    expect(status('seed-parked-van')).toBe('unverified')
    expect(status('seed-flooding')).toBe('verified')
    expect(status('seed-raised-slabs')).toBe('verified')
    expect(status('seed-kerb')).toBe('unverified')
  })

  it('+6 hours makes the parked vehicle outdated; +12 hours the flooding too', () => {
    expect(status('seed-parked-van', NOW + 6 * HOUR)).toBe('outdated')
    expect(status('seed-flooding', NOW + 6 * HOUR)).toBe('verified')
    expect(status('seed-flooding', NOW + 12 * HOUR)).toBe('outdated')
  })

  it('leaves the 60-second demo route (Library to Hostel, Wheelchair) untouched', () => {
    const query = { from: 'library', to: 'hostel', profile: 'wheelchair' } as const
    const clean = findRoute({ campus, reports: [], confirmations: [], now: NOW }, query)
    const seeded = findRoute({ campus, reports, confirmations, now: NOW }, query)
    expect(seeded).toEqual(clean)
  })
})
