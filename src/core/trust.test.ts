import { describe, expect, it } from 'vitest'
import {
  ADMIN_ONLY_CLEAR,
  combinedConfidence,
  confirmationCount,
  DECAY_MS,
  deriveStatus,
  lastConfirmedAt,
  RECONFIRM_AFTER_MS,
  timeUntilOutdatedMs,
  voteBlockReason,
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

function vote(voterId: string, v: Confirmation['vote'] = 'still_there', at = NOW - 1000): Confirmation {
  return { reportId: 'r1', areaId: 'ashgrove', voterId, vote: v, at }
}

describe('derived status', () => {
  it('a new report is unverified', () => {
    expect(deriveStatus(report(), [], NOW)).toBe('unverified')
  })

  it('becomes verified with two independent confirmations', () => {
    expect(deriveStatus(report(), [vote('a')], NOW)).toBe('unverified')
    expect(deriveStatus(report(), [vote('a'), vote('b')], NOW)).toBe('verified')
  })

  it('counts one vote per device and never the reporter', () => {
    const votes = [vote('a'), vote('a'), vote('reporter')]
    expect(confirmationCount(report(), votes)).toBe(1)
    expect(deriveStatus(report(), votes, NOW)).toBe('unverified')
  })

  it('ignores votes for other reports', () => {
    const other = { ...vote('a'), reportId: 'r2' }
    expect(confirmationCount(report(), [other, { ...vote('b'), reportId: 'r2' }])).toBe(0)
  })

  it('an admin verify makes it verified immediately', () => {
    expect(deriveStatus(report({ adminVerifiedAt: NOW }), [], NOW)).toBe('verified')
  })

  it.each(CATEGORIES)('%s goes outdated after its decay time without a confirmation', (category) => {
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

  it('a verified report also goes outdated when nobody re-confirms it', () => {
    const old = NOW - DECAY_MS.parked_vehicle - 1
    const r = report({ category: 'parked_vehicle', createdAt: old, lastConfirmedAt: old, adminVerifiedAt: old })
    expect(deriveStatus(r, [], NOW)).toBe('outdated')
  })

  it('a "still there" vote refreshes freshness', () => {
    const old = NOW - 4 * HOUR
    const r = report({ category: 'parked_vehicle', createdAt: old, lastConfirmedAt: old })
    expect(deriveStatus(r, [], NOW)).toBe('outdated')
    expect(deriveStatus(r, [vote('a', 'still_there', NOW - HOUR)], NOW)).toBe('unverified')
    expect(timeUntilOutdatedMs(r, [vote('a', 'still_there', NOW - HOUR)], NOW)).toBe(2 * HOUR)
  })

  it('a "cleared" vote or admin resolve clears it, even if verified', () => {
    expect(deriveStatus(report({ adminVerifiedAt: NOW }), [vote('a', 'cleared')], NOW)).toBe('cleared')
    expect(deriveStatus(report({ clearedAt: NOW }), [], NOW)).toBe('cleared')
  })
})

describe('combined confidence', () => {
  it('starts at the AI confidence and halves the doubt per confirmation', () => {
    expect(combinedConfidence(report({ confidence: 0.6 }), [])).toBeCloseTo(0.6)
    expect(combinedConfidence(report({ confidence: 0.6 }), [vote('a')])).toBeCloseTo(0.8)
    expect(combinedConfidence(report({ confidence: 0.6 }), [vote('a'), vote('b')])).toBeCloseTo(0.9)
  })

  it('is 1 after an admin verify', () => {
    expect(combinedConfidence(report({ adminVerifiedAt: NOW }), [])).toBe(1)
  })
})

describe('voting rules', () => {
  it('the reporter cannot confirm their own report or keep it fresh', () => {
    expect(voteBlockReason(report(), [], 'reporter', 'still_there', NOW)).toMatch(/You reported this/)
    const own = vote('reporter', 'still_there', NOW)
    expect(lastConfirmedAt(report(), [own])).toBe(NOW - HOUR)
  })

  it('only the admin can clear a report, whatever its status', () => {
    const byAdmin = report({ adminVerifiedAt: NOW - HOUR })
    const byCrowd = [vote('a', 'still_there', NOW - HOUR), vote('b', 'still_there', NOW - HOUR)]
    const old = NOW - 400 * 24 * HOUR
    const stale = report({ createdAt: old, lastConfirmedAt: old, adminVerifiedAt: old })
    expect(deriveStatus(report(), [], NOW)).toBe('unverified')
    expect(deriveStatus(byAdmin, [], NOW)).toBe('verified')
    expect(deriveStatus(report(), byCrowd, NOW)).toBe('verified')
    expect(deriveStatus(stale, [], NOW)).toBe('outdated')
    for (const [r, votes] of [
      [report(), []],
      [byAdmin, []],
      [report(), byCrowd],
      [stale, []],
    ] as const) {
      // Not the reporter, not the people who confirmed it, nobody else either.
      for (const who of ['reporter', 'a', 'c']) {
        expect(voteBlockReason(r, votes, who, 'cleared', NOW)).toBe(ADMIN_ONLY_CLEAR)
      }
      expect(voteBlockReason(r, votes, 'c', 'cleared', NOW, true)).toBeNull()
    }
  })

  it('Still there stays open to everyone, and a cleared report cannot be cleared again', () => {
    expect(voteBlockReason(report({ adminVerifiedAt: NOW - HOUR }), [], 'a', 'still_there', NOW)).toBeNull()
    expect(voteBlockReason(report({ clearedAt: NOW }), [], 'a', 'cleared', NOW, true)).toMatch(/already cleared/)
  })

  it('a device can re-confirm only after the cool-down', () => {
    const mine = [vote('a', 'still_there', NOW - 1000)]
    expect(voteBlockReason(report(), mine, 'a', 'still_there', NOW)).toMatch(/recently/)
    expect(voteBlockReason(report(), mine, 'a', 'still_there', NOW + RECONFIRM_AFTER_MS)).toBeNull()
    expect(voteBlockReason(report(), mine, 'b', 'still_there', NOW)).toBeNull()
  })

  it('no votes on a cleared report', () => {
    expect(voteBlockReason(report({ clearedAt: NOW }), [], 'a', 'still_there', NOW)).toMatch(/already cleared/)
  })
})
