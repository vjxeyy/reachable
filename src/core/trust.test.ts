import { describe, expect, it } from 'vitest'
import {
  ADMIN_ONLY_CLEAR,
  clearBlockReason,
  combinedConfidence,
  DECAY_MS,
  deriveStatus,
  lastConfirmedAt,
  timeUntilOutdatedMs,
} from './trust'
import { CATEGORIES, type Confirmation, type Report } from './types'

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const HOUR = 3_600_000

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1',
    areaId: 'ashgrove',
    pathId: 'p1',
    category: 'blocked_ramp',
    severity: 'blocked',
    status: 'unverified',
    confidence: 0.6,
    aiCategory: 'blocked_ramp',
    photoUrl: null,
    description: '',
    reporterId: 'reporter',
    createdAt: NOW - HOUR,
    lastConfirmedAt: NOW - HOUR,
    clearedAt: null,
    adminVerifiedAt: null,
    ...overrides,
  }
}

function clearedVote(voterId: string, at = NOW - 1000): Confirmation {
  return { reportId: 'r1', areaId: 'ashgrove', voterId, vote: 'cleared', at }
}

/** Rows saved by an older version of the app, when anyone could press "still there". They must have no effect. */
function legacyStillThere(voterId: string, at = NOW - 1000): Confirmation {
  return { reportId: 'r1', areaId: 'ashgrove', voterId, vote: 'still_there' as unknown as 'cleared', at }
}

describe('derived status: only the admin verifies', () => {
  it('a new report is unverified', () => {
    expect(deriveStatus(report(), [], NOW)).toBe('unverified')
  })

  it('an admin verify makes it verified immediately', () => {
    expect(deriveStatus(report({ adminVerifiedAt: NOW }), [], NOW)).toBe('verified')
  })

  it('no number of other people can verify it: old "still there" rows are ignored', () => {
    const crowd = ['a', 'b', 'c', 'd', 'e'].map((id) => legacyStillThere(id))
    expect(deriveStatus(report(), crowd, NOW)).toBe('unverified')
    expect(lastConfirmedAt(report())).toBe(NOW - HOUR)
  })

  it.each(CATEGORIES)('%s goes outdated after its decay time without an admin verify', (category) => {
    const seen = NOW - DECAY_MS[category]
    expect(deriveStatus(report({ category, createdAt: seen, lastConfirmedAt: seen }), [], NOW)).toBe('unverified')
    expect(deriveStatus(report({ category, createdAt: seen - 1, lastConfirmedAt: seen - 1 }), [], NOW)).toBe('outdated')
  })

  it('uses the decay times from the plan', () => {
    expect(DECAY_MS).toEqual({
      parked_vehicle: 3 * HOUR,
      flooding: 12 * HOUR,
      blocked_ramp: 72 * HOUR,
      broken_pavement: 30 * 24 * HOUR,
      missing_kerb_cut: 90 * 24 * HOUR,
      other: 72 * HOUR,
    })
  })

  it('a verified report also goes outdated when the admin does not re-verify it', () => {
    const old = NOW - DECAY_MS.parked_vehicle - 1
    const r = report({ category: 'parked_vehicle', createdAt: old, lastConfirmedAt: old, adminVerifiedAt: old })
    expect(deriveStatus(r, [], NOW)).toBe('outdated')
  })

  it('an admin verify refreshes freshness, and nothing else does', () => {
    const old = NOW - 4 * HOUR
    const r = report({ category: 'parked_vehicle', createdAt: old, lastConfirmedAt: old })
    expect(deriveStatus(r, [], NOW)).toBe('outdated')
    expect(deriveStatus({ ...r, adminVerifiedAt: NOW - HOUR }, [], NOW)).toBe('verified')
    expect(timeUntilOutdatedMs({ ...r, adminVerifiedAt: NOW - HOUR }, NOW)).toBe(2 * HOUR)
    expect(deriveStatus(r, [legacyStillThere('a', NOW - HOUR)], NOW)).toBe('outdated')
  })

  it('a "cleared" vote or admin resolve clears it, even if verified', () => {
    expect(deriveStatus(report({ adminVerifiedAt: NOW }), [clearedVote('a')], NOW)).toBe('cleared')
    expect(deriveStatus(report({ clearedAt: NOW }), [], NOW)).toBe('cleared')
  })

  it('ignores votes for other reports', () => {
    expect(deriveStatus(report(), [{ ...clearedVote('a'), reportId: 'r2' }], NOW)).toBe('unverified')
  })
})

describe('confidence', () => {
  it('is the AI confidence until the admin verifies, then 1', () => {
    expect(combinedConfidence(report({ confidence: 0.6 }))).toBeCloseTo(0.6)
    expect(combinedConfidence(report({ adminVerifiedAt: NOW }))).toBe(1)
  })
})

describe('clearing rules', () => {
  it('only the admin can clear a report, whatever its status', () => {
    const verified = report({ adminVerifiedAt: NOW - HOUR })
    const old = NOW - 400 * 24 * HOUR
    const stale = report({ createdAt: old, lastConfirmedAt: old, adminVerifiedAt: old })
    expect(deriveStatus(report(), [], NOW)).toBe('unverified')
    expect(deriveStatus(verified, [], NOW)).toBe('verified')
    expect(deriveStatus(stale, [], NOW)).toBe('outdated')
    for (const r of [report(), verified, stale]) {
      expect(clearBlockReason(r, [])).toBe(ADMIN_ONLY_CLEAR)
      expect(clearBlockReason(r, [], true)).toBeNull()
    }
  })

  it('a cleared report cannot be cleared again', () => {
    expect(clearBlockReason(report({ clearedAt: NOW }), [], true)).toMatch(/already cleared/)
    expect(clearBlockReason(report(), [clearedVote('a')], true)).toMatch(/already cleared/)
  })
})
