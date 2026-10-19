// Trust and freshness rules (PLAN.md section 6): derived status, decay by category, confidence.

import type { Category, Confirmation, Report, ReportStatus, Timestamp } from './types'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A report becomes `outdated` after this long without a new confirmation. */
export const DECAY_MS: Record<Category, number> = {
  parked_vehicle: 3 * HOUR,
  flooding: 12 * HOUR,
  blocked_ramp: 3 * DAY,
  broken_pavement: 30 * DAY,
  missing_kerb_cut: 90 * DAY,
  other: 3 * DAY,
}

/** Independent "still there" confirmations needed to make a report `verified`. */
export const CONFIRMATIONS_TO_VERIFY = 2

/** A device can say "still there" again only after this long (it refreshes freshness, not the count). */
export const RECONFIRM_AFTER_MS = 30 * 60 * 1000

function votesFor(report: Report, confirmations: readonly Confirmation[]): Confirmation[] {
  return confirmations.filter((c) => c.reportId === report.id)
}

/**
 * Number of independent "still there" votes: one per device, and the reporter's own device
 * does not count.
 */
export function confirmationCount(report: Report, confirmations: readonly Confirmation[]): number {
  const voters = new Set<string>()
  for (const c of votesFor(report, confirmations)) {
    if (c.vote === 'still_there' && c.voterId !== report.reporterId) voters.add(c.voterId)
  }
  return voters.size
}

/**
 * When the obstacle was last seen: the report, an independent "still there" vote or an admin
 * verify. The reporter cannot keep their own report alive.
 */
export function lastConfirmedAt(report: Report, confirmations: readonly Confirmation[]): Timestamp {
  let last = Math.max(report.createdAt, report.lastConfirmedAt, report.adminVerifiedAt ?? 0)
  for (const c of votesFor(report, confirmations)) {
    if (c.vote === 'still_there' && c.voterId !== report.reporterId) last = Math.max(last, c.at)
  }
  return last
}

/** When the report was cleared (a "cleared" vote or admin resolve), or null. */
export function clearedAt(report: Report, confirmations: readonly Confirmation[]): Timestamp | null {
  let cleared = report.clearedAt
  for (const c of votesFor(report, confirmations)) {
    if (c.vote === 'cleared' && (cleared === null || c.at < cleared)) cleared = c.at
  }
  return cleared
}

/**
 * Status, derived fresh every time:
 * cleared > outdated (too long without a confirmation) > verified (2+ independent confirmations
 * or admin verify) > unverified.
 */
export function deriveStatus(
  report: Report,
  confirmations: readonly Confirmation[],
  now: Timestamp,
): ReportStatus {
  if (clearedAt(report, confirmations) !== null) return 'cleared'
  if (now - lastConfirmedAt(report, confirmations) > DECAY_MS[report.category]) return 'outdated'
  if (report.adminVerifiedAt !== null) return 'verified'
  if (confirmationCount(report, confirmations) >= CONFIRMATIONS_TO_VERIFY) return 'verified'
  return 'unverified'
}

/** `verified` and `unverified` reports still affect routes as obstacles. */
export function isActive(status: ReportStatus): boolean {
  return status === 'verified' || status === 'unverified'
}

/**
 * AI confidence combined with confirmations: each independent confirmation halves the
 * remaining doubt. An admin verify means full confidence.
 */
export function combinedConfidence(report: Report, confirmations: readonly Confirmation[]): number {
  if (report.adminVerifiedAt !== null) return 1
  const ai = Math.min(1, Math.max(0, report.confidence))
  return 1 - (1 - ai) * 0.5 ** confirmationCount(report, confirmations)
}

/** Time left before the report goes outdated (negative once it has). */
export function timeUntilOutdatedMs(
  report: Report,
  confirmations: readonly Confirmation[],
  now: Timestamp,
): number {
  return lastConfirmedAt(report, confirmations) + DECAY_MS[report.category] - now
}

/** Returns copies of the reports with `status` filled in for the given time. */
export function withDerivedStatus(
  reports: readonly Report[],
  confirmations: readonly Confirmation[],
  now: Timestamp,
): Report[] {
  return reports.map((r) => ({ ...r, status: deriveStatus(r, confirmations, now) }))
}

/** Shown when someone other than the admin tries to clear a report. */
export const ADMIN_ONLY_CLEAR = 'Only the admin can clear a report. Press Still there if the obstacle is still there.'

/**
 * Why this device may not cast this vote right now, or null if it may.
 * Clearing a report changes the routes everyone sees, and anonymous browsers cannot be told apart from
 * each other, so only the admin may clear a report (`isAdmin`), whatever its status. Anyone may confirm one.
 */
export function voteBlockReason(
  report: Report,
  confirmations: readonly Confirmation[],
  voterId: string,
  vote: Confirmation['vote'],
  now: Timestamp,
  isAdmin = false,
): string | null {
  if (clearedAt(report, confirmations) !== null) return 'This report is already cleared.'
  if (vote === 'cleared') return isAdmin ? null : ADMIN_ONLY_CLEAR
  if (voterId === report.reporterId) return 'You reported this. Someone else needs to confirm it.'
  const mine = votesFor(report, confirmations).filter((c) => c.voterId === voterId && c.vote === 'still_there')
  const latest = Math.max(-Infinity, ...mine.map((c) => c.at))
  if (now - latest < RECONFIRM_AFTER_MS) return 'You confirmed this recently.'
  return null
}
