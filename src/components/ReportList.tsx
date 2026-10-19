import type { ReactNode } from 'react'
import { describePath } from '../core/graph'
import type { Campus, Report } from '../core/types'
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
            <img className="report-thumb" src={report.photoUrl} alt="" loading="lazy" />
          ) : (
            <div className="report-thumb report-thumb-empty" aria-hidden="true">
              !
            </div>
          )}
          <div className="report-body">
            <div className="report-title">
              <strong>{CATEGORY_LABEL[report.category]}</strong>
              <span className="muted small">{report.severity === 'blocked' ? 'blocked' : 'partly blocked'}</span>
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
