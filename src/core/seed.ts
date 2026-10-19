// Turns data/seed-reports.json (times relative to "now") into real reports and confirmations.
// Shared by the browser store and the server so "Reset demo" gives the same result in both.

import { CATEGORIES, SEVERITIES, type Category, type Confirmation, type Report, type Severity, type Timestamp } from './types'

const MINUTE = 60_000

export interface SeedReport {
  id: string
  pathId: string
  category: string
  severity: string
  confidence: number
  aiCategory: string | null
  photoUrl: string | null
  description: string
  reportedMinutesAgo: number
  adminVerifiedMinutesAgo?: number
  stillThere?: { voterId: string; minutesAgo: number }[]
}

export interface SeedFile {
  areaId: string
  reports: SeedReport[]
}

/** The seeds' reporter. Distinct from every real device, so a visitor can confirm a seeded report. */
export const SEED_REPORTER = 'seed-device-1'

export function buildSeed(seed: SeedFile, now: Timestamp): { reports: Report[]; confirmations: Confirmation[] } {
  const reports: Report[] = []
  const confirmations: Confirmation[] = []
  for (const s of seed.reports) {
    if (!(CATEGORIES as readonly string[]).includes(s.category)) throw new Error(`Seed ${s.id}: bad category`)
    if (!(SEVERITIES as readonly string[]).includes(s.severity)) throw new Error(`Seed ${s.id}: bad severity`)
    const createdAt = now - s.reportedMinutesAgo * MINUTE
    const votes = (s.stillThere ?? []).map(
      (v): Confirmation => ({ reportId: s.id, areaId: seed.areaId, voterId: v.voterId, vote: 'still_there', at: now - v.minutesAgo * MINUTE }),
    )
    const adminVerifiedAt = s.adminVerifiedMinutesAgo === undefined ? null : now - s.adminVerifiedMinutesAgo * MINUTE
    reports.push({
      id: s.id,
      areaId: seed.areaId,
      pathId: s.pathId,
      category: s.category as Category,
      severity: s.severity as Severity,
      status: 'unverified',
      confidence: s.confidence,
      aiCategory: (s.aiCategory as Category | null) ?? null,
      photoUrl: s.photoUrl,
      description: s.description,
      reporterId: SEED_REPORTER,
      createdAt,
      lastConfirmedAt: Math.max(createdAt, adminVerifiedAt ?? 0, ...votes.map((v) => v.at)),
      clearedAt: null,
      adminVerifiedAt,
    })
    confirmations.push(...votes)
  }
  return { reports, confirmations }
}
