import { useMemo, useState } from 'react'
import { ReportForm } from '../components/ReportForm'
import { describePath, graphFor } from '../core/graph'
import { campus, notify } from '../state/store'

/**
 * Report an obstacle without touching the map: pick the road from a list, then the same photo,
 * suggestion, severity and note steps as the map's report sheet. Easier on a phone, where the
 * roads on the map are thin.
 */
export function Report() {
  const [pathId, setPathId] = useState('')
  const roads = useMemo(
    () =>
      campus.paths
        .map((p) => ({ id: p.id, label: describePath(campus, p.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  )
  const path = pathId ? graphFor(campus).pathById.get(pathId) : undefined

  return (
    <div className="report-page">
      <section className="panel" aria-labelledby="report-heading">
        <h1 id="report-heading" className="page-title">
          Report an obstacle
        </h1>
        <p className="muted">
          Choose the road, add a photo and say what is wrong. New reports start as unverified, and routes avoid them
          whenever another way exists.
        </p>

        <label className="field report-where">
          <span>Where is it? (required)</span>
          <select value={pathId} onChange={(e) => setPathId(e.target.value)}>
            <option value="">Choose a road</option>
            {roads.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {path && (
          <p className="muted small road-facts">
            {[path.stepFree ? 'step-free' : 'steps', `${path.lengthM} m long`, `${path.widthM} m wide`, `${path.slopePct}% slope`].join(' · ')}
          </p>
        )}

        {path ? (
          <ReportForm
            key={path.id}
            campus={campus}
            pathId={path.id}
            onSubmitted={() => {
              notify('Report saved. Routes updated.')
              window.location.hash = '#/'
            }}
          />
        ) : (
          <p className="muted small">Pick a road above to start the report.</p>
        )}
      </section>
    </div>
  )
}
