import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { mapDecor } from './mapDecor'

const campus = loadCampus(campusData)

describe('mapDecor', () => {
  it('draws the same picture every time', () => {
    expect(mapDecor(campus)).toEqual(mapDecor(campus))
  })

  it('puts a good number of trees on the map, inside its edges', () => {
    const { trees } = mapDecor(campus)
    expect(trees.length).toBeGreaterThanOrEqual(12)
    for (const t of trees) {
      expect(t.x).toBeGreaterThan(0)
      expect(t.x).toBeLessThan(campus.width)
      expect(t.y).toBeGreaterThan(0)
      expect(t.y).toBeLessThan(campus.height)
    }
  })

  it('keeps trees and the pond off places and roads', () => {
    const { trees, pond } = mapDecor(campus)
    const nodes = new Map(campus.nodes.map((n) => [n.id, n]))
    for (const t of trees) {
      for (const n of campus.nodes) expect(Math.hypot(t.x - n.x, t.y - n.y)).toBeGreaterThan(40)
      for (const p of campus.paths) {
        const a = nodes.get(p.from)!
        const b = nodes.get(p.to)!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const u = Math.max(0, Math.min(1, ((t.x - a.x) * dx + (t.y - a.y) * dy) / (dx * dx + dy * dy)))
        expect(Math.hypot(t.x - (a.x + u * dx), t.y - (a.y + u * dy))).toBeGreaterThan(30)
      }
    }
    for (const n of campus.nodes) {
      expect(((n.x - pond.cx) / pond.rx) ** 2 + ((n.y - pond.cy) / pond.ry) ** 2).toBeGreaterThan(1)
    }
  })
})
