import { useMemo, useState } from 'react'
import { CATEGORY_LABEL, STATUS_LABEL } from '../components/labels'
import { ReportList } from '../components/ReportList'
import { TrustBadge } from '../components/TrustBadge'
import { withDerivedStatus } from '../core/trust'
import { CATEGORIES, type Category, type Report, type ReportStatus } from '../core/types'
import { adminResolve, adminVerify, campus, notify, useNow, useStore } from '../state/store'

const STATUSES: ReportStatus[] = ['unverified', 'verified', 'outdated', 'cleared']
const STATUS_ORDER: Record<ReportStatus, number> = { unverified: 0, verified: 1, outdated: 2, cleared: 3 }

/** What the report does to routes right now, in plain words. */
function routeEffect(report: Report): string {
  if (report.status === 'cleared') return 'No effect on routes'
  if (report.status === 'outdated') return 'Warning only, no longer blocks'
  if (report.severity === 'partial') return 'Penalty: routes prefer other paths (low vision avoids it)'
  if (report.status === 'verified') return 'Hard block: path removed from routes'
  return 'Avoided whenever another way exists'
}

/**
 * The Dashboard. Anyone can look at it. Verifying and resolving change what everyone sees, so on the shared
 * server only the signed-in admin gets those buttons. With no server the data is the visitor's own, so the
 * buttons are there, with a note.
 */
export function Admin() {
  const { source, auth } = useStore()
  const shared = source === 'api'
  return <Dashboard shared={shared} canAct={!shared || auth.user !== null} />
}

function Dashboard({ shared, canAct }: { shared: boolean; canAct: boolean }) {
  const { reports, confirmations } = useStore()
  const now = useNow()
  const [status, setStatus] = useState<ReportStatus | 'all'>('all')
  const [category, setCategory] = useState<Category | 'all'>('all')

  const live = useMemo(
    () =>
      withDerivedStatus(reports, confirmations, now).sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt - a.createdAt,
      ),
    [reports, confirmations, now],
  )
  const shown = live.filter((r) => (status === 'all' || r.status === status) && (category === 'all' || r.category === category))

  const active = live.filter((r) => r.status === 'verified' || r.status === 'unverified')
  const affectedPaths = new Set(active.map((r) => r.pathId)).size
  const hardBlocked = new Set(active.filter((r) => r.status === 'verified' && r.severity === 'blocked').map((r) => r.pathId)).size
  const count = (s: ReportStatus) => live.filter((r) => r.status === s).length

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {canAct
              ? 'Verify reports to make them hard blocks, or resolve them once fixed. Changes reach routes at once.'
              : 'Every report and what it does to routes right now. Verifying and resolving are for the admin.'}
          </p>
        </div>
      </header>

      {!shared && (
        <p className="banner" role="note">
          No shared server here, so changes only affect reports saved in this browser.
        </p>
      )}
      {!canAct && (
        <p className="banner" role="note">
          You are viewing the Dashboard. Only the admin can verify or resolve reports. <a href="#/login">Admin login</a>
        </p>
      )}

      <section className="stats" aria-label="Summary">
        <Stat label="Affected paths" value={affectedPaths} hint={`of ${campus.paths.length} paths`} />
        <Stat label="Hard-blocked paths" value={hardBlocked} hint="verified blocks" tone="verified" />
        <Stat label="Needs review" value={count('unverified')} hint="unverified reports" tone="unverified" />
        <Stat label="Outdated" value={count('outdated')} hint="no recent confirmation" tone="outdated" />
      </section>

      <section className="panel">
        <div className="filters">
          <div className="filter-chips" role="group" aria-label="Filter by status">
            {(['all', ...STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip-btn${status === s ? ' is-active' : ''}`}
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
              >
                {s === 'all' ? 'All' : STATUS_LABEL[s]} <span className="chip-count">{s === 'all' ? live.length : count(s)}</span>
              </button>
            ))}
          </div>
          <label className="field filter-select">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category | 'all')}>
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ReportList
          campus={campus}
          reports={shown}
          now={now}
          emptyText="No reports match these filters."
          renderStatus={(report) => (
            <div className="admin-status">
              <TrustBadge report={report} confirmations={confirmations} now={now} />
              <span className="small effect">{routeEffect(report)}</span>
              <span className="small muted">
                {report.aiCategory
                  ? `AI suggested ${CATEGORY_LABEL[report.aiCategory]}${
                      report.aiCategory === report.category ? ', reporter confirmed' : ', reporter corrected it'
                    } · ${Math.round(report.confidence * 100)}% AI confidence`
                  : 'No photo, category chosen by the reporter'}
              </span>
            </div>
          )}
          renderActions={(report) =>
            !canAct || report.status === 'cleared' ? null : (
              <>
                {report.status !== 'verified' && (
                  <button type="button" className="btn btn-danger btn-small" onClick={async () => notify((await adminVerify(report.id)) ?? 'Verified. It now blocks routes.')}>
                    {report.status === 'outdated' ? 'Re-verify' : 'Verify'}
                  </button>
                )}
                <button type="button" className="btn btn-good btn-small" onClick={async () => notify((await adminResolve(report.id)) ?? 'Resolved. Routes updated.')}>
                  Resolve
                </button>
              </>
            )
          }
        />
      </section>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: ReportStatus }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-hint muted small">{hint}</span>
    </div>
  )
}
