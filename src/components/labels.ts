// Display text for core values. Presentation only, no logic.

import type { Category, ReportStatus, Severity } from '../core/types'

export const CATEGORY_LABEL: Record<Category, string> = {
  blocked_ramp: 'Blocked ramp',
  parked_vehicle: 'Parked vehicle',
  flooding: 'Flooding',
  broken_pavement: 'Broken pavement',
  missing_kerb_cut: 'Missing kerb cut',
  other: 'Other obstacle',
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocked: 'Blocked (impassable)',
  partial: 'Partly blocked',
}

export const STATUS_LABEL: Record<ReportStatus, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  outdated: 'Outdated',
  cleared: 'Cleared',
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} days ago`
}

/** "45 min", "5 h", "3 days". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} days`
}

export function formatMetres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}
