// Verification-aware routing (PLAN.md section 6).
//
// cost = lengthM + profilePenalty + obstaclePenalty, found with Dijkstra.
//
// 1. Strict pass: drop paths that break a hard rule or carry any blocking report
//    (verified or unverified). A route found here is the only kind shown as "the route".
// 2. Fallback pass: verified blocks stay excluded, unverified blocks cost +200. A route found
//    here is returned as `no_verified_route` plus this option, labelled "Unverified, use with caution".
// 3. Nothing found: `no_verified_route` with no option.
//
// So an unverified block is avoided whenever any alternative exists, and an uncertain path is
// never presented as the route.

import { graphFor, type CampusGraph } from './graph'
import {
  hardExclusionReason,
  OBSTACLE_PENALTY,
  profilePenalty,
  resolveProfile,
  type Profile,
  type ProfileInput,
} from './profiles'
import { deriveStatus, lastConfirmedAt } from './trust'
import type {
  Campus,
  Category,
  Confirmation,
  Report,
  ReportStatus,
  Severity,
  Timestamp,
} from './types'

export const UNVERIFIED_LABEL = 'Unverified, use with caution'

export interface RouteQuery {
  from: string
  to: string
  /** One profile, or several at once (they combine into the strictest of them). */
  profile: ProfileInput
}

export interface RouteInput {
  campus: Campus
  reports: readonly Report[]
  confirmations: readonly Confirmation[]
  now: Timestamp
}

/**
 * How a report affects a path for one profile:
 * - excluded: verified block, the path is removed
 * - unverified_block: removed in the strict pass, +200 in the fallback pass
 * - partial: penalty, shown as a warning
 * - outdated: +20, shown as a warning
 */
export type ObstacleEffect = 'excluded' | 'unverified_block' | 'partial' | 'outdated'

export interface ReportImpact {
  reportId: string
  pathId: string
  category: Category
  /** Severity as reported. Low vision treats every active obstacle as blocking. */
  severity: Severity
  status: ReportStatus
  effect: ObstacleEffect
  /** Cost added to the path (0 when the path is excluded). */
  penalty: number
  createdAt: Timestamp
  lastConfirmedAt: Timestamp
}

export interface RouteLeg {
  pathId: string
  from: string
  to: string
  lengthM: number
  cost: number
  stepFree: boolean
  /** Reports on this leg that changed its cost. */
  impacts: ReportImpact[]
}

export interface Route {
  nodeIds: string[]
  pathIds: string[]
  legs: RouteLeg[]
  lengthM: number
  cost: number
  /** True when every leg is step-free in the map data. */
  stepFree: boolean
  /** `verified`: avoids every blocking report. `unverified`: crosses at least one unverified block. */
  verification: 'verified' | 'unverified'
  label: string
  /** Partial and outdated reports on the route. */
  warnings: ReportImpact[]
  /** Unverified blocks the route crosses (only on unverified routes). */
  unverifiedBlocks: ReportImpact[]
}

export interface Reroute {
  /** Extra metres compared with the route you would get with no reports at all. */
  extraM: number
  /** The route you would get with no reports. */
  usualPathIds: string[]
  /** Reports on the usual route that pushed the route elsewhere. */
  because: ReportImpact[]
}

export type RouteResult =
  | {
      status: 'ok'
      query: RouteQuery
      route: Route
      /** Set when reports moved the route away from the usual one. */
      reroute: Reroute | null
    }
  | {
      status: 'no_verified_route'
      query: RouteQuery
      message: string
      /** no_path_for_profile: the map itself has no usable path. blocked_by_reports: reports block every path. */
      reason: 'no_path_for_profile' | 'blocked_by_reports'
      /** The best route through unverified blocks, never to be shown as the route. */
      alternative: Route | null
      /** Blocking reports, ideally ones where clearing any single one would restore a route. */
      blockedBy: ReportImpact[]
    }

type Pass = 'usual' | 'strict' | 'fallback'

type ImpactMap = Map<string, ReportImpact[]>

interface Found {
  nodeIds: string[]
  legs: RouteLeg[]
}

function impactOf(
  report: Report,
  status: ReportStatus,
  profile: Profile,
): Pick<ReportImpact, 'effect' | 'penalty'> | null {
  if (status === 'cleared') return null
  if (status === 'outdated') return { effect: 'outdated', penalty: OBSTACLE_PENALTY.outdated }
  const severity: Severity = profile.activeObstacleBlocks ? 'blocked' : report.severity
  if (severity === 'blocked') {
    return status === 'verified'
      ? { effect: 'excluded', penalty: 0 }
      : { effect: 'unverified_block', penalty: OBSTACLE_PENALTY.unverifiedBlocked }
  }
  return { effect: 'partial', penalty: profile.partialPenalty }
}

/** Effects of every report on every path, for one profile at one moment. */
export function computeImpacts(input: RouteInput, profileInput: ProfileInput): ImpactMap {
  const profile = resolveProfile(profileInput)
  const graph = graphFor(input.campus)
  const impacts: ImpactMap = new Map()
  for (const report of input.reports) {
    if (report.areaId !== input.campus.areaId || !graph.pathById.has(report.pathId)) continue
    const status = deriveStatus(report, input.confirmations, input.now)
    const impact = impactOf(report, status, profile)
    if (!impact) continue
    const list = impacts.get(report.pathId) ?? []
    list.push({
      reportId: report.id,
      pathId: report.pathId,
      category: report.category,
      severity: report.severity,
      status,
      ...impact,
      createdAt: report.createdAt,
      lastConfirmedAt: lastConfirmedAt(report, input.confirmations),
    })
    impacts.set(report.pathId, list)
  }
  return impacts
}

const isBlocking = (i: ReportImpact) => i.effect === 'excluded' || i.effect === 'unverified_block'

/**
 * Cost of one path for this pass, or null if it cannot be used. Several reports on one path do
 * not stack: the worst one counts, so duplicate reports of one obstacle are not double-counted.
 */
function legCost(
  pathImpacts: readonly ReportImpact[],
  pass: Pass,
  lengthM: number,
  shapePenalty: number,
): { cost: number; impacts: ReportImpact[] } | null {
  const base = lengthM + shapePenalty
  if (pass === 'usual') return { cost: base, impacts: [] }
  let obstaclePenalty = 0
  for (const impact of pathImpacts) {
    if (impact.effect === 'excluded') return null
    if (impact.effect === 'unverified_block' && pass === 'strict') return null
    obstaclePenalty = Math.max(obstaclePenalty, impact.penalty)
  }
  return { cost: base + obstaclePenalty, impacts: [...pathImpacts] }
}

/** Dijkstra with deterministic tie-breaking (data order of nodes and paths). */
function shortest(
  graph: CampusGraph,
  profile: Profile,
  impacts: ImpactMap,
  pass: Pass,
  from: string,
  to: string,
): Found | null {
  const nodes = graph.campus.nodes
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, { node: string; leg: RouteLeg }>()
  const done = new Set<string>()

  for (;;) {
    let current: string | null = null
    let best = Infinity
    for (const node of nodes) {
      const d = dist.get(node.id)
      if (d !== undefined && !done.has(node.id) && d < best) {
        best = d
        current = node.id
      }
    }
    if (current === null) return null
    if (current === to) break
    done.add(current)

    for (const { path, to: next } of graph.adjacency.get(current) ?? []) {
      if (done.has(next)) continue
      if (hardExclusionReason(profile, path) !== null) continue
      const leg = legCost(impacts.get(path.id) ?? [], pass, path.lengthM, profilePenalty(profile, path))
      if (!leg) continue
      const candidate = best + leg.cost
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate)
        prev.set(next, {
          node: current,
          leg: {
            pathId: path.id,
            from: current,
            to: next,
            lengthM: path.lengthM,
            cost: leg.cost,
            stepFree: path.stepFree,
            impacts: leg.impacts,
          },
        })
      }
    }
  }

  const nodeIds = [to]
  const legs: RouteLeg[] = []
  let at = to
  while (at !== from) {
    const step = prev.get(at)
    if (!step) return null
    legs.unshift(step.leg)
    nodeIds.unshift(step.node)
    at = step.node
  }
  return { nodeIds, legs }
}

function toRoute(found: Found, profile: Profile, verification: Route['verification']): Route {
  const impacts = found.legs.flatMap((leg) => leg.impacts)
  return {
    nodeIds: found.nodeIds,
    pathIds: found.legs.map((leg) => leg.pathId),
    legs: found.legs,
    lengthM: found.legs.reduce((sum, leg) => sum + leg.lengthM, 0),
    cost: found.legs.reduce((sum, leg) => sum + leg.cost, 0),
    stepFree: found.legs.every((leg) => leg.stepFree),
    verification,
    label: verification === 'verified' ? `${profile.routeNoun}, no blocking reports` : UNVERIFIED_LABEL,
    warnings: impacts.filter((i) => i.effect === 'partial' || i.effect === 'outdated'),
    unverifiedBlocks: impacts.filter((i) => i.effect === 'unverified_block'),
  }
}

function samePathIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** Blocking reports where clearing that one report alone would bring back a verified route. */
function findBlockers(
  graph: CampusGraph,
  profile: Profile,
  impacts: ImpactMap,
  query: RouteQuery,
  usual: Found,
): ReportImpact[] {
  const candidates = [...impacts.values()].flat().filter(isBlocking)
  const single = candidates.filter((candidate) => {
    const without: ImpactMap = new Map()
    for (const [pathId, list] of impacts) {
      without.set(pathId, list.filter((i) => i.reportId !== candidate.reportId))
    }
    return shortest(graph, profile, without, 'strict', query.from, query.to) !== null
  })
  if (single.length > 0) return single
  const usualPaths = new Set(usual.legs.map((leg) => leg.pathId))
  return candidates.filter((i) => usualPaths.has(i.pathId))
}

export function findRoute(input: RouteInput, query: RouteQuery): RouteResult {
  const graph = graphFor(input.campus)
  if (!graph.nodeById.has(query.from)) throw new Error(`Unknown start node: ${query.from}`)
  if (!graph.nodeById.has(query.to)) throw new Error(`Unknown destination node: ${query.to}`)
  const profile = resolveProfile(query.profile)
  const impacts = computeImpacts(input, query.profile)

  const usual = shortest(graph, profile, impacts, 'usual', query.from, query.to)
  const strict = shortest(graph, profile, impacts, 'strict', query.from, query.to)

  if (strict) {
    const route = toRoute(strict, profile, 'verified')
    let reroute: Reroute | null = null
    if (usual && !samePathIds(route.pathIds, usual.legs.map((l) => l.pathId))) {
      const chosen = new Set(route.pathIds)
      const because = usual.legs
        .filter((leg) => !chosen.has(leg.pathId))
        .flatMap((leg) => impacts.get(leg.pathId) ?? [])
      if (because.length > 0) {
        const usualLength = usual.legs.reduce((sum, leg) => sum + leg.lengthM, 0)
        reroute = {
          extraM: route.lengthM - usualLength,
          usualPathIds: usual.legs.map((l) => l.pathId),
          because,
        }
      }
    }
    return { status: 'ok', query, route, reroute }
  }

  const message = profile.noVerifiedRouteText
  if (!usual) {
    return { status: 'no_verified_route', query, message, reason: 'no_path_for_profile', alternative: null, blockedBy: [] }
  }
  const fallback = shortest(graph, profile, impacts, 'fallback', query.from, query.to)
  return {
    status: 'no_verified_route',
    query,
    message,
    reason: 'blocked_by_reports',
    alternative: fallback ? toRoute(fallback, profile, 'unverified') : null,
    blockedBy: findBlockers(graph, profile, impacts, query, usual),
  }
}
