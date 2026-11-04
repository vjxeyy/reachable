import { useMemo, useState } from 'react'
import { CampusMap, type MapMarker } from '../components/CampusMap'
import { ReportSheet } from '../components/ReportForm'
import { ReportList } from '../components/ReportList'
import { RoutePanel, RouteSummary, type OptionKind } from '../components/RoutePanel'
import { findRoute, type Route } from '../core/route'
import { isActive } from '../core/trust'
import type { Report, ReportStatus } from '../core/types'
import { campus, notify, setSelection, useStore } from '../state/store'
import { useReportViews } from './reportViews'

const STATUS_RANK: Record<ReportStatus, number> = { verified: 3, unverified: 2, outdated: 1, cleared: 0 }

function markersFor(reports: Report[]): MapMarker[] {
  const byPath = new Map<string, MapMarker>()
  for (const r of reports) {
    if (r.status === 'cleared') continue
    const existing = byPath.get(r.pathId)
    if (!existing) byPath.set(r.pathId, { pathId: r.pathId, status: r.status, count: 1 })
    else {
      existing.count++
      if (STATUS_RANK[r.status] > STATUS_RANK[existing.status]) existing.status = r.status
    }
  }
  return [...byPath.values()]
}

export function Home() {
  const { selection, source, auth } = useStore()
  const { profiles, from, to } = selection
  const { reports, confirmations, now, live, visible, renderStatus, renderActions } = useReportViews()
  const [shownOptionKey, setShownOptionKey] = useState<string | null>(null)
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null)

  const result = useMemo(
    () => (from && to ? findRoute({ campus, reports, confirmations, now }, { from, to, profile: profiles }) : null),
    [reports, confirmations, now, from, to, profiles],
  )
  const activeCount = live.filter((r) => isActive(r.status)).length
  const markers = useMemo(() => markersFor(live), [live])

  const route = result?.status === 'ok' ? result.route : null
  const partialOption = result?.status === 'no_verified_route' ? result.partialOption : null
  const unverifiedOption = result?.status === 'no_verified_route' ? result.alternative : null
  // A caution option is drawn only after the user asks, and only the one they asked about.
  const optionKey = (kind: OptionKind, option: Route | null) =>
    option ? `${kind}:${profiles.join(',')}:${option.pathIds.join('>')}` : null
  const shownOption: OptionKind | null =
    partialOption && shownOptionKey === optionKey('partial', partialOption)
      ? 'partial'
      : unverifiedOption && shownOptionKey === optionKey('unverified', unverifiedOption)
        ? 'unverified'
        : null
  const drawnOption = shownOption === 'partial' ? partialOption : shownOption === 'unverified' ? unverifiedOption : null

  return (
    <div className="home">
      <p className="intro">
        Step-free routes for wheelchair, crutch and low-vision users, redrawn when a barrier is reported or cleared.
      </p>
      <div className="area-controls">
        <RoutePanel
          campus={campus}
          profiles={profiles}
          from={from}
          to={to}
          onChange={setSelection}
        />
      </div>
      <div className="area-map">
        <div className="map-card">
          <div className="map-tags">
            <span className="map-tag">{campus.name}</span>
            <span className="map-tag map-tag-quiet">Illustrative map, not to scale</span>
          </div>
          <CampusMap
            campus={campus}
            profiles={profiles}
            route={route}
            caution={drawnOption}
            from={from}
            to={to}
            markers={markers}
            selectedPathId={selectedPathId}
            onPathSelect={setSelectedPathId}
          />
          <MapLegend />
          <p className="map-hint muted small">
            Tap a road to report a problem or see its reports, or{' '}
            <a href="#/report">report an obstacle from a list</a>.
          </p>
        </div>
      </div>
      <div className="area-result">
        <RouteSummary
          campus={campus}
          result={result}
          now={now}
          activeReportCount={activeCount}
          shownOption={shownOption}
          onToggleOption={(kind) =>
            setShownOptionKey(shownOption === kind ? null : optionKey(kind, kind === 'partial' ? partialOption : unverifiedOption))
          }
          onSelectPath={setSelectedPathId}
        />
      </div>
      <div className="area-reports">
        <section className="panel" aria-labelledby="reports-heading">
          <h2 id="reports-heading">Live reports</h2>
          {source === 'api' && !auth.user && (
            <p className="muted small reports-note">Anyone can confirm a report. Only the admin can mark one cleared.</p>
          )}
          <ReportList
            campus={campus}
            reports={visible}
            now={now}
            emptyText="No reports yet. Tap a path on the map to report a problem."
            onSelectPath={setSelectedPathId}
            renderStatus={renderStatus}
            renderActions={renderActions}
          />
        </section>
      </div>

      {selectedPathId && (
        <ReportSheet
          key={selectedPathId}
          campus={campus}
          pathId={selectedPathId}
          onClose={() => setSelectedPathId(null)}
          onSubmitted={() => {
            setSelectedPathId(null)
            notify('Report saved. Routes updated.')
          }}
        >
          <ReportList
            campus={campus}
            reports={visible.filter((r) => r.pathId === selectedPathId)}
            now={now}
            showPath={false}
            emptyText="No live reports on this path."
            renderStatus={renderStatus}
            renderActions={renderActions}
          />
        </ReportSheet>
      )}
    </div>
  )
}

function MapLegend() {
  return (
    <ul className="legend" aria-label="Map legend">
      <li>
        <svg width="34" height="12" aria-hidden="true">
          <line x1="2" y1="6" x2="32" y2="6" className="legend-route" />
        </svg>
        Your route
      </li>
      <li>
        <svg width="34" height="12" aria-hidden="true">
          <line x1="4" y1="6" x2="30" y2="6" className="legend-path-edge" />
          <line x1="4" y1="6" x2="30" y2="6" className="legend-path" />
        </svg>
        Step-free path
      </li>
      <li>
        <svg width="34" height="12" aria-hidden="true">
          <line x1="2" y1="6" x2="32" y2="6" className="legend-steps" />
        </svg>
        Steps
      </li>
      <li>
        <svg width="34" height="12" aria-hidden="true">
          <g className="legend-faded">
            <line x1="4" y1="6" x2="30" y2="6" className="legend-path-edge" />
            <line x1="4" y1="6" x2="30" y2="6" className="legend-path" />
          </g>
        </svg>
        Not usable with this profile
      </li>
      <li>
        <svg width="34" height="12" aria-hidden="true">
          <line x1="2" y1="6" x2="32" y2="6" className="legend-caution" />
        </svg>
        Option to use with caution
      </li>
      <li>
        <span className="legend-dot legend-verified" /> Verified
        <span className="legend-dot legend-unverified" /> Unverified
        <span className="legend-dot legend-outdated" /> Outdated report
      </li>
    </ul>
  )
}
