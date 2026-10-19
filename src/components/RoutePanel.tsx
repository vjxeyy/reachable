import { describePath, graphFor } from '../core/graph'
import { PROFILES } from '../core/profiles'
import type { ReportImpact, Route, RouteResult } from '../core/route'
import { PROFILE_IDS, type Campus, type ProfileId } from '../core/types'
import { CheckIcon, ProfileIcon, SwapIcon } from './icons'
import { CATEGORY_LABEL, formatAgo, formatMetres, STATUS_LABEL } from './labels'

interface PanelProps {
  campus: Campus
  profiles: ProfileId[]
  from: string
  to: string
  onChange: (patch: { profiles?: ProfileId[]; from?: string; to?: string }) => void
}

/** Profile, start and destination pickers. */
const DEFAULT_PROFILES: ProfileId[] = ['wheelchair']

function StopSelect({
  label,
  placeholder,
  value,
  campus,
  onPick,
}: {
  label: string
  placeholder: string
  value: string
  campus: Campus
  onPick: (id: string) => void
}) {
  const sorted = [...campus.nodes].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value)}>
        <option value="">{placeholder}</option>
        {sorted.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Start and destination stacked, then the profile check boxes. */
export function RoutePanel({ campus, profiles, from, to, onChange }: PanelProps) {
  const touched = from !== '' || to !== '' || profiles.join() !== DEFAULT_PROFILES.join()
  return (
    <section className="panel route-panel" aria-labelledby="route-heading">
      <h2 id="route-heading">Find a route</h2>
      <div className="od">
        <div className="od-row od-from">
          <span className="od-mark" aria-hidden="true" />
          <StopSelect label="From" placeholder="Choose start" value={from} campus={campus} onPick={(id) => onChange({ from: id })} />
        </div>
        <div className="od-row od-to">
          <span className="od-mark" aria-hidden="true" />
          <StopSelect label="To" placeholder="Choose destination" value={to} campus={campus} onPick={(id) => onChange({ to: id })} />
        </div>
        <button
          type="button"
          className="swap"
          aria-label="Swap start and destination"
          title="Swap start and destination"
          onClick={() => onChange({ from: to, to: from })}
        >
          <SwapIcon />
        </button>
      </div>
      <fieldset className="profiles">
        <legend>Profile</legend>
        {PROFILE_IDS.map((id) => {
          const checked = profiles.includes(id)
          const onlyOne = checked && profiles.length === 1
          return (
            <label
              key={id}
              className={`profile-option${checked ? ' is-active' : ''}`}
              title={onlyOne ? 'At least one profile must stay ticked' : undefined}
            >
              <input
                type="checkbox"
                name="profile"
                value={id}
                checked={checked}
                // The last ticked box stays ticked: a route always needs a profile.
                disabled={onlyOne}
                onChange={() =>
                  onChange({
                    profiles: PROFILE_IDS.filter((p) => (p === id ? !checked : profiles.includes(p))),
                  })
                }
              />
              <span className="profile-box" aria-hidden="true">
                {checked && <CheckIcon size={12} />}
              </span>
              <ProfileIcon profile={id} />
              <span>{PROFILES[id].name}</span>
            </label>
          )
        })}
      </fieldset>
      <div className="panel-foot">
        <span className="muted small">Tick every profile that applies.</span>
        {touched && (
          <button
            type="button"
            className="link-btn"
            onClick={() => onChange({ profiles: DEFAULT_PROFILES, from: '', to: '' })}
          >
            Reset
          </button>
        )}
      </div>
    </section>
  )
}

interface ImpactProps {
  campus: Campus
  impact: ReportImpact
  now: number
  onSelectPath?: (pathId: string) => void
}

function ImpactLine({ campus, impact, now, onSelectPath }: ImpactProps) {
  const where = describePath(campus, impact.pathId)
  return (
    <li>
      <strong>{CATEGORY_LABEL[impact.category]}</strong> on{' '}
      {onSelectPath ? (
        <button type="button" className="link-btn" onClick={() => onSelectPath(impact.pathId)}>
          {where}
        </button>
      ) : (
        where
      )}
      <span className={`pill pill-${impact.status}`}>{STATUS_LABEL[impact.status]}</span>
      <span className="muted"> reported {formatAgo(now - impact.createdAt)}</span>
    </li>
  )
}

function Legs({ campus, route }: { campus: Campus; route: Route }) {
  const graph = graphFor(campus)
  const name = (id: string) => graph.nodeById.get(id)?.name ?? id
  return (
    <ol className="legs">
      {route.legs.map((leg) => {
        const path = graph.pathById.get(leg.pathId)
        const notes: string[] = []
        if (path && !path.stepFree) notes.push('steps')
        if (path && path.slopePct >= 5) notes.push(`${path.slopePct}% slope`)
        if (path && path.widthM < 1.5) notes.push(`${path.widthM} m wide`)
        return (
          <li key={leg.pathId}>
            {name(leg.from)} to {name(leg.to)}
            <span className="muted">
              {' '}
              · {formatMetres(leg.lengthM)}
              {notes.length > 0 && ` · ${notes.join(', ')}`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

interface SummaryProps {
  campus: Campus
  result: RouteResult | null
  now: number
  activeReportCount: number
  showCaution: boolean
  onToggleCaution: () => void
  /** Opens a path's reports, e.g. to confirm or clear a block. */
  onSelectPath?: (pathId: string) => void
}

/** The route result: the route, why it changed, or the fail-safe message. */
export function RouteSummary({
  campus,
  result,
  now,
  activeReportCount,
  showCaution,
  onToggleCaution,
  onSelectPath,
}: SummaryProps) {
  if (!result) {
    return (
      <section className="panel result result-empty" aria-live="polite">
        <p>Pick a start and a destination to see a route for your profile.</p>
      </section>
    )
  }
  const graph = graphFor(campus)
  const toName = graph.nodeById.get(result.query.to)?.name ?? result.query.to

  if (result.status === 'ok') {
    const { route, reroute } = result
    return (
      <section className="panel result result-ok" aria-live="polite">
        <div className="result-head">
          <h2>{route.label}</h2>
          <div className="chips">
            {route.stepFree ? <span className="chip chip-good">Step-free</span> : <span className="chip">Includes steps</span>}
            <span className="chip">{formatMetres(route.lengthM)}</span>
          </div>
        </div>
        {route.pathIds.length === 0 && <p>You are already at {toName}.</p>}
        {reroute && (
          <div className="callout callout-info">
            <p>
              <strong>Rerouted</strong>, {formatMetres(reroute.extraM)} longer than usual, to avoid:
            </p>
            <ul className="impacts">
              {reroute.because.map((impact) => (
                <ImpactLine key={impact.reportId} campus={campus} impact={impact} now={now} onSelectPath={onSelectPath} />
              ))}
            </ul>
          </div>
        )}
        {route.warnings.length > 0 && (
          <div className="callout callout-warn">
            <p>
              <strong>Heads up</strong> on this route:
            </p>
            <ul className="impacts">
              {route.warnings.map((impact) => (
                <ImpactLine key={impact.reportId} campus={campus} impact={impact} now={now} onSelectPath={onSelectPath} />
              ))}
            </ul>
          </div>
        )}
        {route.legs.length > 0 && <Legs campus={campus} route={route} />}
        <p className="fine">
          Based on the campus map and {activeReportCount} live {activeReportCount === 1 ? 'report' : 'reports'}.
          Conditions change, so check on site.
        </p>
      </section>
    )
  }

  const option = result.alternative
  return (
    <section className="panel result result-none" role="alert">
      <div className="result-head">
        <h2>{result.message}</h2>
      </div>
      {result.reason === 'no_path_for_profile' ? (
        <p>The campus map has no path to {toName} that fits this profile (steps, narrow or steep paths).</p>
      ) : (
        <>
          <p>Reports block every usable path to {toName}. Clearing any one of these would bring a route back:</p>
          <ul className="impacts">
            {result.blockedBy.map((impact) => (
              <ImpactLine key={impact.reportId} campus={campus} impact={impact} now={now} onSelectPath={onSelectPath} />
            ))}
          </ul>
        </>
      )}
      {option ? (
        <div className="callout callout-caution">
          <p>
            <strong>{option.label}.</strong> The best remaining option is {formatMetres(option.lengthM)} and crosses{' '}
            {option.unverifiedBlocks.length} unverified {option.unverifiedBlocks.length === 1 ? 'block' : 'blocks'}.
          </p>
          <button type="button" className="btn btn-ghost" aria-pressed={showCaution} onClick={onToggleCaution}>
            {showCaution ? 'Hide unverified option' : 'Show unverified option on map'}
          </button>
        </div>
      ) : (
        result.reason === 'blocked_by_reports' && <p className="muted">There is no unverified option either.</p>
      )}
    </section>
  )
}
