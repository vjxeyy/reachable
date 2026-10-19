import type { ReactNode } from 'react'
import { describePath } from '../core/graph'
import { SEED_REPORTER } from '../core/seed'
import { ADMIN_ONLY_CLEAR } from '../core/trust'
import type { Campus, Report } from '../core/types'
import { photoSrc } from '../state/api'
import { CATEGORY_LABEL, formatAgo, STATUS_LABEL } from './labels'

interface Props {
  campus: Campus
  /** Reports with `status` already derived for `now`. */
  reports: Report[]
  now: number
  emptyText: string
  showPath?: boolean
  onSelectPath?: (pathId: string) => void
  /** Extra controls under each report (confirm, clear, verify...). */
  renderActions?: (report: Report) => ReactNode
  /** Replaces the plain status pill, e.g. with a TrustBadge. */
  renderStatus?: (report: Report) => ReactNode
}

export function ReportList({ campus, reports, now, emptyText, showPath = true, onSelectPath, renderActions, renderStatus }: Props) {
  if (reports.length === 0) return <p className="muted small empty">{emptyText}</p>
  return (
    <ul className="report-list">
      {reports.map((report) => (
        <li key={report.id} className={`report-item report-${report.status}`}>
          {report.photoUrl ? (
            <img className="report-thumb" src={photoSrc(report.photoUrl) ?? undefined} alt="" loading="lazy" />
          ) : (
            <div className="report-thumb report-thumb-empty" aria-hidden="true">
              No photo
            </div>
          )}
          <div className="report-body">
            <div className="report-title">
              <strong>{CATEGORY_LABEL[report.category]}</strong>
              <span className="muted small">{report.severity === 'blocked' ? 'blocked' : 'partly blocked'}</span>
              {report.reporterId === SEED_REPORTER && (
                <span className="tag-example" title="Made-up report that ships with the demo">
                  Example
                </span>
              )}
            </div>
            {showPath &&
              (onSelectPath ? (
                <button type="button" className="link-btn report-path" onClick={() => onSelectPath(report.pathId)}>
                  {describePath(campus, report.pathId)}
                </button>
              ) : (
                <span className="report-path">{describePath(campus, report.pathId)}</span>
              ))}
            <div className="report-meta">
              {renderStatus ? (
                renderStatus(report)
              ) : (
                <>
                  <span className={`pill pill-${report.status}`}>{STATUS_LABEL[report.status]}</span>
                  <span className="muted small"> reported {formatAgo(now - report.createdAt)}</span>
                </>
              )}
            </div>
            {report.description && <p className="report-desc">{report.description}</p>}
            {renderActions && <div className="report-actions">{renderActions(report)}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}

interface VoteProps {
  report: Report
  /** Returns why the vote is not allowed, or null. */
  blockedReason: (vote: 'still_there' | 'cleared') => string | null
  onVote: (vote: 'still_there' | 'cleared') => void
}

/** "Still there" and "Cleared" buttons. Disabled buttons say why. */
export function VoteButtons({ report, blockedReason, onVote }: VoteProps) {
  if (report.status === 'cleared') return null
  const stillReason = blockedReason('still_there')
  const clearReason = blockedReason('cleared')
  return (
    <>
      <button
        type="button"
        className="btn btn-quiet btn-small"
        disabled={stillReason !== null}
        title={stillReason ?? 'Confirm the obstacle is still there'}
        onClick={() => onVote('still_there')}
      >
        Still there
      </button>
      {/* Only the admin can clear a report, so everyone else does not get the button at all. */}
      {clearReason !== ADMIN_ONLY_CLEAR && (
        <button
          type="button"
          className="btn btn-good btn-small"
          disabled={clearReason !== null}
          title={clearReason ?? 'Mark the obstacle as gone'}
          onClick={() => onVote('cleared')}
        >
          Cleared
        </button>
      )}
      {stillReason && <span className="muted small vote-note">{stillReason}</span>}
    </>
  )
}
