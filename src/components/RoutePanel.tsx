import { describePath, graphFor } from '../core/graph'
import type { RouteFit } from '../core/fit'
import type { ReportImpact, Route, RouteResult } from '../core/route'
import type { Campus, ProfileId } from '../core/types'
import { SwapIcon } from './icons'
import { ProfileChoices } from './ProfileChoices'
import { ReadAloud } from './ReadAloud'
import { StopSelect } from './StopSelect'
import { VoiceRoute } from './VoiceRoute'
import { CATEGORY_LABEL, formatAgo, formatMetres, STATUS_LABEL } from './labels'

interface PanelProps {
  campus: Campus
  profiles: ProfileId[]
  from: string
  to: string
  onChange: (patch: { profiles?: ProfileId[]; from?: string; to?: string }) => void
}

/** Profile, start and destination pickers: start and destination stacked, then the profile check boxes. */
export function RoutePanel({ campus, profiles, from, to, onChange }: PanelProps) {
  const touched = from !== '' || to !== '' || profiles.length > 0
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
      <VoiceRoute campus={campus} from={from} to={to} profiles={profiles} onApply={(f, t, p) => onChange({ from: f, to: t, profiles: p })} />
      <ProfileChoices profiles={profiles} onChange={(next) => onChange({ profiles: next })} />
      <div className="panel-foot">
        <span className="muted small">Tick every profile that applies.</span>
        {touched && (
          <button
            type="button"
            className="link-btn"
            onClick={() => onChange({ profiles: [], from: '', to: '' })}
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

export type OptionKind = 'partial' | 'unverified'

const FIT_CLASS: Record<RouteFit['verdict'], string> = {
  good: 'fit-good',
  caution: 'fit-caution',
  not_advised: 'fit-bad',
}

/** The fit check: a verdict in words (never colour alone) and the reasons behind it. */
function FitBlock({ fit }: { fit: RouteFit }) {
  return (
    <div className={`fit ${FIT_CLASS[fit.verdict]}`}>
      <p className="fit-head">
        <strong>Is it good for you?</strong> {fit.headline}
      </p>
      {fit.notes.length > 0 && (
        <ul className="fit-notes">
          {fit.notes.map((note, i) => (
            <li key={`${note.pathId}-${i}`}>
              <span className="fit-level">{note.level === 'warn' ? 'Take care' : 'Note'}</span> {note.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What is still needed before a route can be found. */
export type Missing = 'profile' | 'start' | 'destination'

const MISSING_TEXT: Record<Missing, string> = { profile: 'your profile', start: 'a start', destination: 'a destination' }

interface SummaryProps {
  campus: Campus
  result: RouteResult | null
  /** Why there is no result yet, so the empty state can say what to choose. */
  missing?: Missing[]
  now: number
  activeReportCount: number
  /** Which caution option is drawn on the map, if any. */
  shownOption: OptionKind | null
  onToggleOption: (kind: OptionKind) => void
  /** Opens a path's reports, e.g. to see or clear a block. */
  onSelectPath?: (pathId: string) => void
}

/** The route result: the route, why it changed, or the fail-safe message. */
export function RouteSummary({
  campus,
  result,
  missing = [],
  now,
  activeReportCount,
  shownOption,
  onToggleOption,
  onSelectPath,
}: SummaryProps) {
  if (!result) {
    return (
      <section className="panel result result-empty" aria-live="polite">
        <p>
          {missing.length > 0
            ? `Still needed: ${missing.map((m) => MISSING_TEXT[m]).join(', ')}.`
            : 'Pick a profile, a start and a destination to see a route.'}
        </p>
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
        <ReadAloud
          campus={campus}
          route={route}
          reroute={reroute}
          now={now}
          ownerKey={`ok:${result.query.from}>${result.query.to}:${route.label}:${route.pathIds.join('>')}`}
        />
        <p className="fine">
          Based on the campus map and {activeReportCount} live {activeReportCount === 1 ? 'report' : 'reports'}.
          Conditions change, so check on site.
        </p>
      </section>
    )
  }

  const partial = result.partialOption
  // An unverified option that crosses the same paths as the partly blocked one adds nothing: show one.
  const same = partial !== null && result.alternative !== null && partial.pathIds.join('>') === result.alternative.pathIds.join('>')
  const option = same ? null : result.alternative
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
      {partial && (
        <div className="callout callout-caution">
          <p>
            <strong>{partial.label}.</strong> Best way round: {formatMetres(partial.lengthM)} over{' '}
            {partial.warnings.length === 1 ? 'a path' : 'paths'} reported as only partly blocked, never fully blocked. This is
            not a verified route. What is in the way:
          </p>
          <ul className="impacts">
            {partial.warnings.map((impact) => (
              <ImpactLine key={impact.reportId} campus={campus} impact={impact} now={now} onSelectPath={onSelectPath} />
            ))}
          </ul>
          <FitBlock fit={partial.fit} />
          <Legs campus={campus} route={partial} />
          <ReadAloud campus={campus} route={partial} now={now} ownerKey={`partial:${result.query.from}>${result.query.to}:${partial.pathIds.join('>')}`} />
          <button type="button" className="btn btn-ghost" aria-pressed={shownOption === 'partial'} onClick={() => onToggleOption('partial')}>
            {shownOption === 'partial' ? 'Hide partly blocked option' : 'Show partly blocked option on map'}
          </button>
        </div>
      )}
      {option ? (
        <div className="callout callout-caution">
          <p>
            <strong>{option.label}.</strong> {partial ? 'Another option' : 'The best remaining option'} is{' '}
            {formatMetres(option.lengthM)} and crosses {option.unverifiedBlocks.length} unverified{' '}
            {option.unverifiedBlocks.length === 1 ? 'block' : 'blocks'}.
          </p>
          <FitBlock fit={option.fit} />
          <ReadAloud campus={campus} route={option} now={now} ownerKey={`unverified:${result.query.from}>${result.query.to}:${option.pathIds.join('>')}`} />
          <button type="button" className="btn btn-ghost" aria-pressed={shownOption === 'unverified'} onClick={() => onToggleOption('unverified')}>
            {shownOption === 'unverified' ? 'Hide unverified option' : 'Show unverified option on map'}
          </button>
        </div>
      ) : (
        result.reason === 'blocked_by_reports' &&
        !partial && <p className="muted">There is no unverified option and no partly blocked path that leads there.</p>
      )}
    </section>
  )
}
