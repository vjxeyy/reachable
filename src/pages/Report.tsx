import { useMemo, useState } from 'react'
import { CampusMap } from '../components/CampusMap'
import { ReportForm, Step } from '../components/ReportForm'
import { ReportList } from '../components/ReportList'
import { describePath, graphFor } from '../core/graph'
import { findRoute } from '../core/route'
import { campus, notify, useStore } from '../state/store'
import { useReportViews } from './reportViews'

/**
 * Report an obstacle without needing the thin roads on the map: pick the road from a list (or tap it on
 * the small map), then add a photo, the problem, how bad it is and a note. Every step shows from the start.
 */
export function Report() {
  const [pathId, setPathId] = useState('')
  const { selection, source, auth } = useStore()
  const { reports, confirmations, now, visible, renderStatus, renderActions } = useReportViews()

  const roads = useMemo(
    () =>
      campus.paths
        .map((p) => ({ id: p.id, label: describePath(campus, p.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  )

  // Roads of the route being looked at on the map, so the likely one is easy to find.
  const { from, to, profiles } = selection
  const routePathIds = useMemo(() => {
    if (!from || !to) return []
    const result = findRoute({ campus, reports, confirmations, now }, { from, to, profile: profiles })
    return result.status === 'ok' ? result.route.pathIds : []
  }, [from, to, profiles, reports, confirmations, now])
  const onRoute = roads.filter((r) => routePathIds.includes(r.id))
  const others = roads.filter((r) => !routePathIds.includes(r.id))

  const path = pathId ? graphFor(campus).pathById.get(pathId) : undefined
  const option = (r: { id: string; label: string }) => (
    <option key={r.id} value={r.id}>
      {r.label}
    </option>
  )

  return (
    <div className="report-page">
      <header className="report-head">
        <h1 className="page-title">Report an obstacle</h1>
        <p className="muted">
          Choose the road, add a photo and say what is wrong. New reports start as unverified, and routes avoid them
          whenever another way exists.
        </p>
      </header>

      <div className="report-grid">
        <section className="panel" aria-label="New report">
          <div className="report-steps">
            <Step n={1} title="Where is it?">
              <label className="field">
                <span className="visually-hidden">Road</span>
                <select value={pathId} onChange={(e) => setPathId(e.target.value)}>
                  <option value="">Choose a road</option>
                  {onRoute.length > 0 ? (
                    <>
                      <optgroup label="On your route">{onRoute.map(option)}</optgroup>
                      <optgroup label="Other roads">{others.map(option)}</optgroup>
                    </>
                  ) : (
                    roads.map(option)
                  )}
                </select>
              </label>
              {path && (
                <p className="muted small">
                  {[path.stepFree ? 'step-free' : 'steps', `${path.lengthM} m long`, `${path.widthM} m wide`, `${path.slopePct}% slope`].join(' · ')}
                </p>
              )}
              <div className="where-map">
                <CampusMap campus={campus} route={null} caution={null} from="" to="" selectedPathId={pathId || null} onPathSelect={setPathId} actionLabel="Choose this road" />
              </div>
              <p className="muted small">Or tap the road on this map. The chosen road is highlighted in yellow.</p>
            </Step>

            <ReportForm
              campus={campus}
              pathId={path ? path.id : null}
              firstStep={2}
              onSubmitted={() => {
                notify('Report saved. Routes updated.')
                window.location.hash = '#/'
              }}
            />
          </div>
        </section>

        <section className="panel report-feed" aria-labelledby="feed-heading">
          <h2 id="feed-heading">Recent reports</h2>
          <p className="muted small">
            {source === 'api' && !auth.user
              ? 'Confirm a report that is still there. Only the admin can mark one cleared.'
              : 'Confirm a report that is still there, or mark it cleared once the way is open.'}
          </p>
          <ReportList
            campus={campus}
            reports={visible}
            now={now}
            emptyText="No reports yet."
            renderStatus={renderStatus}
            renderActions={renderActions}
          />
        </section>
      </div>
    </div>
  )
}
