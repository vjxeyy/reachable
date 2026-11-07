// Trust and freshness rules (PLAN.md section 6): derived status, decay by category, confidence.
// Only the admin verifies or clears a report. Visitors can only file one, so a report is Unverified until
// the admin verifies it, and it goes Outdated if the admin does not re-verify it within its decay time.

import type { Category, Confirmation, Report, ReportStatus, Timestamp } from './types'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A report becomes `outdated` after this long without an admin verify. */
export const DECAY_MS: Record<Category, number> = {
  parked_vehicle: 3 * HOUR,
  flooding: 12 * HOUR,
  blocked_ramp: 3 * DAY,
  broken_pavement: 30 * DAY,
  missing_kerb_cut: 90 * DAY,
  other: 3 * DAY,
}

/**
 * When the obstacle was last seen: the report itself or an admin verify. Nobody else can refresh it.
 */
export function lastConfirmedAt(report: Report): Timestamp {
  return Math.max(report.createdAt, report.lastConfirmedAt, report.adminVerifiedAt ?? 0)
}

/** When the report was cleared (a "cleared" vote or admin resolve), or null. */
export function clearedAt(report: Report, confirmations: readonly Confirmation[]): Timestamp | null {
  let cleared = report.clearedAt
  for (const c of confirmations) {
    if (c.reportId === report.id && c.vote === 'cleared' && (cleared === null || c.at < cleared)) cleared = c.at
  }
  return cleared
}

/**
 * Status, derived fresh every time:
 * cleared > outdated (too long without an admin verify) > verified (the admin verified it) > unverified.
 */
export function deriveStatus(
  report: Report,
  confirmations: readonly Confirmation[],
  now: Timestamp,
): ReportStatus {
  if (clearedAt(report, confirmations) !== null) return 'cleared'
  if (now - lastConfirmedAt(report) > DECAY_MS[report.category]) return 'outdated'
  if (report.adminVerifiedAt !== null) return 'verified'
  return 'unverified'
}

/** `verified` and `unverified` reports still affect routes as obstacles. */
export function isActive(status: ReportStatus): boolean {
  return status === 'verified' || status === 'unverified'
}

/** The AI's confidence in the category. An admin verify means full confidence. */
export function combinedConfidence(report: Report): number {
  if (report.adminVerifiedAt !== null) return 1
  return Math.min(1, Math.max(0, report.confidence))
}

/** Time left before the report goes outdated (negative once it has). */
export function timeUntilOutdatedMs(report: Report, now: Timestamp): number {
  return lastConfirmedAt(report) + DECAY_MS[report.category] - now
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
export const ADMIN_ONLY_CLEAR = 'Only the admin can clear a report.'

/**
 * Why this device may not clear this report right now, or null if it may.
 * Clearing a report changes the routes everyone sees, and anonymous browsers cannot be told apart from
 * each other, so only the admin may clear a report (`isAdmin`), whatever its status.
 */
export function clearBlockReason(
  report: Report,
  confirmations: readonly Confirmation[],
  isAdmin = false,
): string | null {
  if (clearedAt(report, confirmations) !== null) return 'This report is already cleared.'
  return isAdmin ? null : ADMIN_ONLY_CLEAR
}
