import type { KeyboardEvent } from 'react'
import { pathKind } from '../core/graph'
import { hardExclusionReason, resolveProfile } from '../core/profiles'
import type { Route } from '../core/route'
import type { Campus, CampusNode, ProfileId, ReportStatus } from '../core/types'

/** One marker per path that has live reports. */
export interface MapMarker {
  pathId: string
  /** Worst status on the path, decides the colour. */
  status: ReportStatus
  count: number
}

interface Props {
  campus: Campus
  /** The ticked profiles; paths the combination cannot use are faded. */
  profiles: readonly ProfileId[]
  route: Route | null
  /** Unverified option, drawn only when the user asks to see it. */
  caution: Route | null
  from: string
  to: string
  markers?: MapMarker[]
  selectedPathId?: string | null
  onPathSelect?: (pathId: string) => void
}

const PAD = 24

function midpoint(a: CampusNode, b: CampusNode) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function points(route: Route, nodes: Map<string, CampusNode>): string {
  return route.nodeIds
    .map((id) => nodes.get(id))
    .filter((n): n is CampusNode => Boolean(n))
    .map((n) => `${n.x},${n.y}`)
    .join(' ')
}

/** Splits "Health Centre" into two short lines so labels stay readable on a phone. */
function labelLines(name: string): string[] {
  const words = name.split(' ')
  if (words.length < 2) return [name]
  const cut = Math.ceil(words.length / 2)
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')]
}

function badgeText(kind: ReturnType<typeof pathKind>, slopePct: number, widthM: number): string | null {
  if (kind === 'ramp' || kind === 'steep') return `${slopePct}%`
  if (kind === 'narrow') return `${widthM} m`
  return null
}

function onKeyActivate(event: KeyboardEvent, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

export function CampusMap({ campus, profiles, route, caution, from, to, markers = [], selectedPathId, onPathSelect }: Props) {
  const nodes = new Map(campus.nodes.map((n) => [n.id, n]))
  const prof = resolveProfile(profiles)
  const routeKey = route ? route.pathIds.join('>') : ''
  const onRoute = new Set(route?.nodeIds ?? [])

  return (
    <svg
      className="campus-map"
      viewBox={`${-PAD} ${-PAD} ${campus.width + PAD * 2} ${campus.height + PAD * 2}`}
      role="img"
      aria-label={`Map of ${campus.name}`}
    >
      <rect x={-PAD} y={-PAD} width={campus.width + PAD * 2} height={campus.height + PAD * 2} rx={28} className="map-bg" />

      <g className="paths">
        {campus.paths.map((path) => {
          const a = nodes.get(path.from)
          const b = nodes.get(path.to)
          if (!a || !b) return null
          const excluded = hardExclusionReason(prof, path)
          const kind = pathKind(path)
          const label = `${a.name} to ${b.name}, ${path.lengthM} m${path.stepFree ? '' : ', steps'}${
            excluded ? `, not usable with ${prof.name} (${excluded})` : ''
          }`
          return (
            <g key={path.id} className={`path path-${kind}${excluded ? ' path-excluded' : ''}${selectedPathId === path.id ? ' path-selected' : ''}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="path-casing" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="path-line" />
              {onPathSelect && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="path-hit"
                  role="button"
                  tabIndex={0}
                  aria-label={`Report a problem: ${label}`}
                  onClick={() => onPathSelect(path.id)}
                  onKeyDown={(e) => onKeyActivate(e, () => onPathSelect(path.id))}
                >
                  <title>{label}</title>
                </line>
              )}
            </g>
          )
        })}
      </g>

      {caution && (
        <g className="caution-route" aria-label="Unverified option, use with caution">
          <polyline points={points(caution, nodes)} className="caution-casing" />
          <polyline points={points(caution, nodes)} className="caution-line" />
        </g>
      )}

      {route && route.pathIds.length > 0 && (
        <g className="route" key={routeKey}>
          <polyline points={points(route, nodes)} className="route-casing" />
          <polyline points={points(route, nodes)} className="route-line" pathLength={1} />
          {route.legs
            .filter((leg) => !leg.stepFree)
            .map((leg) => {
              const a = nodes.get(leg.from)
              const b = nodes.get(leg.to)
              return a && b ? <line key={leg.pathId} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="route-steps" /> : null
            })}
        </g>
      )}

      <g className="badges" aria-hidden="true">
        {campus.paths.map((path) => {
          const a = nodes.get(path.from)
          const b = nodes.get(path.to)
          const badge = badgeText(pathKind(path), path.slopePct, path.widthM)
          if (!a || !b || !badge) return null
          const mid = midpoint(a, b)
          const excluded = hardExclusionReason(prof, path) !== null
          return (
            <text key={path.id} x={mid.x + 14} y={mid.y - 14} className={`path-badge${excluded ? ' path-excluded' : ''}`}>
              {badge}
            </text>
          )
        })}
      </g>

      <g className="markers">
        {markers.map((marker) => {
          const path = campus.paths.find((p) => p.id === marker.pathId)
          const a = path && nodes.get(path.from)
          const b = path && nodes.get(path.to)
          if (!a || !b) return null
          const mid = midpoint(a, b)
          return (
            <g
              key={marker.pathId}
              className={`marker marker-${marker.status}`}
              transform={`translate(${mid.x} ${mid.y})`}
              onClick={onPathSelect ? () => onPathSelect(marker.pathId) : undefined}
            >
              <circle r={15} />
              <text y={6}>{marker.count > 1 ? marker.count : '!'}</text>
            </g>
          )
        })}
      </g>

      <g className="nodes">
        {campus.nodes.map((node) => {
          const lines = labelLines(node.name)
          const below = node.y < campus.height - 40
          const firstY = below ? node.y + 34 : node.y - 22 - (lines.length - 1) * 24
          const role = node.id === from ? 'start' : node.id === to ? 'end' : onRoute.has(node.id) ? 'via' : ''
          return (
            <g key={node.id} className={`node${role ? ` node-${role}` : ''}`}>
              <circle cx={node.x} cy={node.y} r={role === 'start' || role === 'end' ? 15 : 11} />
              {role === 'end' && <circle cx={node.x} cy={node.y} r={5} className="node-end-dot" />}
              <text x={node.x} y={firstY} className="node-label">
                {lines.map((line, i) => (
                  <tspan key={i} x={node.x} dy={i === 0 ? 0 : '1.1em'}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
