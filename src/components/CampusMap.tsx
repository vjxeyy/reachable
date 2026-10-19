import { useMemo, type KeyboardEvent } from 'react'
import { pathKind } from '../core/graph'
import { hardExclusionReason, resolveProfile } from '../core/profiles'
import type { Route } from '../core/route'
import type { Campus, CampusNode, NodeKind, ProfileId, ReportStatus } from '../core/types'
import { mapDecor } from './mapDecor'

/** One marker per path that has live reports. */
export interface MapMarker {
  pathId: string
  /** Worst status on the path, decides the colour. */
  status: ReportStatus
  count: number
}

interface Props {
  campus: Campus
  /** The ticked profiles; paths the combination cannot use are faded. Leave out to show every road alike. */
  profiles?: readonly ProfileId[]
  route: Route | null
  /** Unverified option, drawn only when the user asks to see it. */
  caution: Route | null
  from: string
  to: string
  markers?: MapMarker[]
  selectedPathId?: string | null
  onPathSelect?: (pathId: string) => void
  /** What tapping a road does, for screen readers. */
  actionLabel?: string
}

const PAD = 24

/** Half the height of each kind of place, so its label can sit just clear of it. */
const HALF_HEIGHT: Record<NodeKind, number> = { building: 23, green: 32, field: 29, lot: 22, gate: 14, stop: 11 }

/** Where a place's name is drawn: its lines, the baseline of the first line and the box the text covers. */
function labelPlacement(node: CampusNode, campus: Campus) {
  const lines = labelLines(node.name)
  const half = HALF_HEIGHT[node.kind ?? 'building']
  const below = node.y < campus.height - 60
  const firstY = below ? node.y + half + 24 : node.y - half - 10 - (lines.length - 1) * 24
  const box = {
    x0: node.x - 62,
    x1: node.x + 62,
    y0: firstY - 20,
    y1: firstY + (lines.length - 1) * 23 + 8,
  }
  return { lines, firstY, box }
}

/**
 * Where a path's report marker and slope badge go: the middle of the road, slid along it when the
 * middle would sit on top of a place's name.
 */
function roadSpot(a: CampusNode, b: CampusNode, campus: Campus, margin = 16) {
  const boxes = campus.nodes.map((n) => labelPlacement(n, campus).box)
  for (const t of [0.5, 0.4, 0.6, 0.33, 0.67]) {
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    const hidden = boxes.some((m) => x > m.x0 - margin && x < m.x1 + margin && y > m.y0 - margin && y < m.y1 + margin)
    if (!hidden) return { x, y }
  }
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

/** The drawing of one place: a building, lawn, pitch, car park, gate or bus stop. Centred on (0, 0). */
function Place({ kind }: { kind: NodeKind }) {
  switch (kind) {
    case 'green':
      return (
        <>
          <ellipse rx={50} ry={32} className="place-lawn" />
          <circle r={9} className="place-pool" />
        </>
      )
    case 'field':
      return (
        <>
          <rect x={-48} y={-29} width={96} height={58} rx={6} className="place-lawn" />
          <line x1={0} y1={-24} x2={0} y2={24} className="place-line" />
          <circle r={10} className="place-line" />
        </>
      )
    case 'lot':
      return (
        <>
          <rect x={-40} y={-22} width={80} height={44} rx={3} className="place-lot" />
          <text className="place-lot-mark" y={7}>
            P
          </text>
        </>
      )
    case 'gate':
      return (
        <>
          <rect x={-32} y={-14} width={9} height={28} rx={2} className="place-post" />
          <rect x={23} y={-14} width={9} height={28} rx={2} className="place-post" />
          <line x1={-23} y1={0} x2={23} y2={0} className="place-bar" />
        </>
      )
    case 'stop':
      return (
        <>
          <rect x={-15} y={-11} width={30} height={22} rx={3} className="place-sign" />
          <line x1={-9} y1={0} x2={9} y2={0} className="place-sign-line" />
        </>
      )
    default:
      return (
        <>
          <rect x={-38} y={-23} width={76} height={46} rx={5} className="place-building" />
          <rect x={-31} y={-16} width={62} height={32} rx={3} className="place-roof" />
        </>
      )
  }
}

export function CampusMap({ campus, profiles, route, caution, from, to, markers = [], selectedPathId, onPathSelect, actionLabel = 'Report a problem' }: Props) {
  const nodes = new Map(campus.nodes.map((n) => [n.id, n]))
  const prof = profiles ? resolveProfile(profiles) : null
  const routeKey = route ? route.pathIds.join('>') : ''
  const onRoute = new Set(route?.nodeIds ?? [])
  const decor = useMemo(() => mapDecor(campus), [campus])
  const full = { x: -PAD, y: -PAD, width: campus.width + PAD * 2, height: campus.height + PAD * 2 }

  return (
    <svg
      className="campus-map"
      viewBox={`${full.x} ${full.y} ${full.width} ${full.height}`}
      role="img"
      aria-label={`Illustrated map of ${campus.name}`}
    >
      <defs>
        <clipPath id="map-clip">
          <rect {...full} rx={10} />
        </clipPath>
      </defs>
      <rect {...full} rx={10} className="map-bg" />

      <g clipPath="url(#map-clip)" aria-hidden="true">
        <ellipse cx={decor.pond.cx} cy={decor.pond.cy} rx={decor.pond.rx} ry={decor.pond.ry} className="map-pond" />
        <g className="map-trees">
          {decor.trees.map((t) => (
            <g key={`${t.x}-${t.y}`}>
              <circle cx={t.x} cy={t.y} r={t.r} className="tree" />
            </g>
          ))}
        </g>
      </g>

      <g className="paths">
        {campus.paths.map((path) => {
          const a = nodes.get(path.from)
          const b = nodes.get(path.to)
          if (!a || !b) return null
          const excluded = prof ? hardExclusionReason(prof, path) : null
          const kind = pathKind(path)
          const label = `${a.name} to ${b.name}, ${path.lengthM} m${path.stepFree ? '' : ', steps'}${
            excluded && prof ? `, not usable with ${prof.name} (${excluded})` : ''
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
                  aria-label={`${actionLabel}: ${label}`}
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

      <g className="places" aria-hidden="true">
        {campus.nodes.map((node) => (
          <g key={node.id} className="place" transform={`translate(${node.x} ${node.y})`}>
            <Place kind={node.kind ?? 'building'} />
          </g>
        ))}
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
          const mid = roadSpot(a, b, campus, 4)
          const excluded = prof ? hardExclusionReason(prof, path) !== null : false
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
          const mid = roadSpot(a, b, campus)
          return (
            <g
              key={marker.pathId}
              className={`marker marker-${marker.status}`}
              transform={`translate(${mid.x} ${mid.y})`}
              onClick={onPathSelect ? () => onPathSelect(marker.pathId) : undefined}
            >
              <polygon points="0,-19 19,0 0,19 -19,0" />
              <text y={6}>{marker.count > 1 ? marker.count : '!'}</text>
            </g>
          )
        })}
      </g>

      <g className="nodes">
        {campus.nodes.map((node) => {
          const { lines, firstY } = labelPlacement(node, campus)
          const role = node.id === from ? 'start' : node.id === to ? 'end' : onRoute.has(node.id) ? 'via' : ''
          return (
            <g key={node.id} className={`node${role ? ` node-${role}` : ''}`}>
              {role && <circle cx={node.x} cy={node.y} r={role === 'start' || role === 'end' ? 15 : 9} />}
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

      <g className="compass" aria-hidden="true" transform={`translate(${campus.width - 28} ${campus.height - 52})`}>
        <polygon points="0,-18 8,6 0,1 -8,6" className="compass-arrow" />
        <text y={26} className="compass-n">
          N
        </text>
      </g>
    </svg>
  )
}
