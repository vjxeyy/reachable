// Decoration for the illustrated map: a pond in the emptiest corner and trees in the gaps.
// Pure and deterministic (seeded from the campus id), so the picture is the same on every load and device.
// It is drawing only: nothing here is data, and routing never reads it.

import type { Campus, CampusNode, CampusPath } from '../core/types'

export interface Tree {
  x: number
  y: number
  r: number
}

export interface Pond {
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface Decor {
  pond: Pond
  trees: Tree[]
}

/** Half the width of a drawn road, plus room for a tree trunk. */
const ROAD_CLEARANCE = 36
/** Area under and beside a place's label where no tree is drawn. */
const LABEL_HALF_WIDTH = 95
const LABEL_ABOVE = 60
const LABEL_BELOW = 85
const MAX_TREES = 26
/** Trees stay in the margin around the map so the middle, where the roads are, stays calm. */
const MARGIN_BAND = 120
const MIN_TREE_GAP = 22

function seedFrom(text: string): number {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/** Small seeded random number generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function distanceToSegment(px: number, py: number, a: CampusNode, b: CampusNode): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSq))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

function insidePond(x: number, y: number, pond: Pond, margin = 1): boolean {
  return ((x - pond.cx) / (pond.rx * margin)) ** 2 + ((y - pond.cy) / (pond.ry * margin)) ** 2 <= 1
}

/** The pond sits in whichever map corner is furthest from every place, so it never covers one. */
function choosePond(campus: Campus): Pond {
  const rx = campus.width * 0.13
  const ry = campus.height * 0.14
  const corners = [
    [0, 0],
    [campus.width, 0],
    [0, campus.height],
    [campus.width, campus.height],
  ]
  let best: Pond = { cx: 0, cy: 0, rx, ry }
  let bestScore = -Infinity
  for (const [cx, cy] of corners) {
    // How far the nearest place is, measured in pond radii: above 1 means the pond clears it.
    const score = Math.min(
      ...campus.nodes.map((n) => Math.hypot((n.x - cx) / (rx + LABEL_HALF_WIDTH * 0.5), (n.y - cy) / (ry + LABEL_BELOW * 0.5))),
    )
    if (score > bestScore) {
      bestScore = score
      best = { cx, cy, rx, ry }
    }
  }
  return best
}

export function mapDecor(campus: Campus): Decor {
  const nodes = new Map(campus.nodes.map((n) => [n.id, n]))
  const segments: [CampusNode, CampusNode][] = []
  for (const path of campus.paths as CampusPath[]) {
    const a = nodes.get(path.from)
    const b = nodes.get(path.to)
    if (a && b) segments.push([a, b])
  }
  const pond = choosePond(campus)
  const next = random(seedFrom(campus.areaId))
  const trees: Tree[] = []

  for (let attempt = 0; attempt < 900 && trees.length < MAX_TREES; attempt++) {
    const r = 8 + next() * 5
    const x = 14 + next() * (campus.width - 28)
    const y = 14 + next() * (campus.height - 28)
    if (insidePond(x, y, pond, 1.2)) continue
    if (Math.min(x, y, campus.width - x, campus.height - y) > MARGIN_BAND) continue
    if (campus.nodes.some((n) => Math.abs(x - n.x) < LABEL_HALF_WIDTH && y > n.y - LABEL_ABOVE && y < n.y + LABEL_BELOW)) continue
    if (segments.some(([a, b]) => distanceToSegment(x, y, a, b) < ROAD_CLEARANCE + r)) continue
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + MIN_TREE_GAP)) continue
    trees.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) })
  }
  return { pond, trees }
}
