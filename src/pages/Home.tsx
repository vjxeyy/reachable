import { useMemo, useState } from 'react'
import { CampusMap } from '../components/CampusMap'
import { RoutePanel, RouteSummary } from '../components/RoutePanel'
import { findRoute } from '../core/route'
import { isActive, withDerivedStatus } from '../core/trust'
import type { ProfileId } from '../core/types'
import { campus, useNow, useStore } from '../state/store'

export function Home() {
  const { reports, confirmations } = useStore()
  const now = useNow()
  const [profile, setProfile] = useState<ProfileId>('wheelchair')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cautionShownFor, setCautionShownFor] = useState<string | null>(null)

  const result = useMemo(
    () => (from && to ? findRoute({ campus, reports, confirmations, now }, { from, to, profile }) : null),
    [reports, confirmations, now, from, to, profile],
  )
  const live = useMemo(() => withDerivedStatus(reports, confirmations, now), [reports, confirmations, now])
  const activeCount = live.filter((r) => isActive(r.status)).length

  const route = result?.status === 'ok' ? result.route : null
  const option = result?.status === 'no_verified_route' ? result.alternative : null
  // The unverified option is drawn only after the user asks, and only for the option they asked about.
  const optionKey = option ? `${profile}:${option.pathIds.join('>')}` : null
  const showCaution = optionKey !== null && cautionShownFor === optionKey

  return (
    <div className="home">
      <div className="area-controls">
        <RoutePanel
          campus={campus}
          profile={profile}
          from={from}
          to={to}
          onChange={(patch) => {
            if (patch.profile !== undefined) setProfile(patch.profile)
            if (patch.from !== undefined) setFrom(patch.from)
            if (patch.to !== undefined) setTo(patch.to)
          }}
        />
      </div>
      <div className="area-map">
        <div className="map-card">
          <CampusMap
            campus={campus}
            profile={profile}
            route={route}
            caution={showCaution ? option : null}
            from={from}
            to={to}
          />
          <MapLegend />
        </div>
      </div>
      <div className="area-result">
        <RouteSummary
          campus={campus}
          result={result}
          now={now}
          activeReportCount={activeCount}
          showCaution={showCaution}
          onToggleCaution={() => setCautionShownFor(showCaution ? null : optionKey)}
        />
      </div>
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
          <line x1="2" y1="6" x2="32" y2="6" className="legend-path" />
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
          <line x1="2" y1="6" x2="32" y2="6" className="legend-path legend-faded" />
        </svg>
        Not usable with this profile
      </li>
      <li>
        <svg width="34" height="12" aria-hidden="true">
          <line x1="2" y1="6" x2="32" y2="6" className="legend-caution" />
        </svg>
        Unverified option
      </li>
    </ul>
  )
}
