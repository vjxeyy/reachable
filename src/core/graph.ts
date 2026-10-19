// Campus graph helpers: validation, lookups and adjacency. Works for any campus data file.

import { NODE_KINDS, type Campus, type CampusNode, type CampusPath } from './types'

export interface Neighbour {
  path: CampusPath
  /** The node at the other end of the path. */
  to: string
}

export interface CampusGraph {
  campus: Campus
  nodeById: Map<string, CampusNode>
  pathById: Map<string, CampusPath>
  /** Node index in campus.nodes, used for deterministic tie-breaking. */
  nodeIndex: Map<string, number>
  /** Neighbours of each node, in the order the paths appear in the data. */
  adjacency: Map<string, Neighbour[]>
}

/** Checks a parsed campus file and returns it typed. Throws with a clear message if it is broken. */
export function loadCampus(data: unknown): Campus {
  const campus = data as Campus
  if (!campus || typeof campus.areaId !== 'string' || !Array.isArray(campus.nodes) || !Array.isArray(campus.paths)) {
    throw new Error('Campus data must have areaId, nodes and paths')
  }
  const nodeIds = new Set<string>()
  for (const node of campus.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`)
    if (node.areaId !== campus.areaId) throw new Error(`Node ${node.id} has areaId ${node.areaId}`)
    if (node.kind !== undefined && !(NODE_KINDS as readonly string[]).includes(node.kind)) {
      throw new Error(`Node ${node.id} has unknown kind ${node.kind}`)
    }
    nodeIds.add(node.id)
  }
  const pathIds = new Set<string>()
  for (const path of campus.paths) {
    if (pathIds.has(path.id)) throw new Error(`Duplicate path id: ${path.id}`)
    if (!nodeIds.has(path.from) || !nodeIds.has(path.to)) throw new Error(`Path ${path.id} links an unknown node`)
    if (path.from === path.to) throw new Error(`Path ${path.id} is a loop`)
    if (path.areaId !== campus.areaId) throw new Error(`Path ${path.id} has areaId ${path.areaId}`)
    if (!(path.lengthM > 0) || !(path.widthM > 0) || !(path.slopePct >= 0)) {
      throw new Error(`Path ${path.id} has invalid length, width or slope`)
    }
    pathIds.add(path.id)
  }
  return campus
}

export function buildGraph(campus: Campus): CampusGraph {
  const nodeById = new Map(campus.nodes.map((n) => [n.id, n]))
  const pathById = new Map(campus.paths.map((p) => [p.id, p]))
  const nodeIndex = new Map(campus.nodes.map((n, i) => [n.id, i]))
  const adjacency = new Map<string, Neighbour[]>(campus.nodes.map((n) => [n.id, []]))
  for (const path of campus.paths) {
    adjacency.get(path.from)?.push({ path, to: path.to })
    adjacency.get(path.to)?.push({ path, to: path.from })
  }
  return { campus, nodeById, pathById, nodeIndex, adjacency }
}

const graphCache = new WeakMap<Campus, CampusGraph>()

/** buildGraph, cached per campus object. */
export function graphFor(campus: Campus): CampusGraph {
  let graph = graphCache.get(campus)
  if (!graph) {
    graph = buildGraph(campus)
    graphCache.set(campus, graph)
  }
  return graph
}

/** Short kind of path for labels: steps, ramp, narrow, steep or path. */
export function pathKind(path: CampusPath): 'steps' | 'ramp' | 'steep' | 'narrow' | 'path' {
  if (!path.stepFree) return 'steps'
  if (path.slopePct > 8) return 'steep'
  if (path.slopePct >= 5) return 'ramp'
  if (path.widthM < 0.9) return 'narrow'
  return 'path'
}

/** Human label such as "Canteen to Hostel ramp". */
export function describePath(campus: Campus, pathId: string): string {
  const graph = graphFor(campus)
  const path = graph.pathById.get(pathId)
  if (!path) return pathId
  const from = graph.nodeById.get(path.from)?.name ?? path.from
  const to = graph.nodeById.get(path.to)?.name ?? path.to
  const kind = pathKind(path)
  return kind === 'path' ? `${from} to ${to}` : `${from} to ${to} ${kind}`
}
