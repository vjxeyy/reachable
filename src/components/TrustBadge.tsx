import {
  clearedAt,
  combinedConfidence,
  confirmationCount,
  CONFIRMATIONS_TO_VERIFY,
  DECAY_MS,
  lastConfirmedAt,
  timeUntilOutdatedMs,
} from '../core/trust'
import type { Confirmation, Report } from '../core/types'
import { StatusIcon } from './icons'
import { CATEGORY_LABEL, formatAgo, formatDuration, STATUS_LABEL } from './labels'

interface Props {
  /** Report with `status` derived for `now`. */
  report: Report
  confirmations: readonly Confirmation[]
  now: number
}

/** Status, age and trust details for one report. Never shows a status without its age. */
export function TrustBadge({ report, confirmations, now }: Props) {
  const count = confirmationCount(report, confirmations)
  const seen = lastConfirmedAt(report, confirmations)
  const cleared = clearedAt(report, confirmations)
  const confidence = Math.round(combinedConfidence(report, confirmations) * 100)

  let detail: string
  if (report.status === 'cleared') {
    detail = `cleared ${formatAgo(now - (cleared ?? now))}`
  } else if (report.status === 'outdated') {
    detail = `not confirmed for ${formatDuration(now - seen)}. ${CATEGORY_LABEL[report.category]} reports expire after ${formatDuration(
      DECAY_MS[report.category],
    )}, so it no longer blocks routes`
  } else if (report.status === 'verified') {
    detail = report.adminVerifiedAt !== null ? 'verified by an admin' : `${count} independent confirmations`
  } else {
    detail = `${count} of ${CONFIRMATIONS_TO_VERIFY} confirmations needed`
  }

  const active = report.status === 'verified' || report.status === 'unverified'
  return (
    <div className={`trust trust-${report.status}`}>
      <span className={`pill pill-${report.status}`}>
        <StatusIcon status={report.status} size={12} /> {STATUS_LABEL[report.status]}
      </span>
      <span className="trust-detail">{detail}</span>
      <span className="trust-meta muted">
        Reported {formatAgo(now - report.createdAt)}
        {seen > report.createdAt && report.status !== 'cleared' && ` · last confirmed ${formatAgo(now - seen)}`}
        {active && ` · outdated in ${formatDuration(timeUntilOutdatedMs(report, confirmations, now))}`}
        {active && ` · ${confidence}% confidence`}
      </span>
    </div>
  )
}
