import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../core/types'
import { simulateClassification } from './simulated'

const bytes = (seed: number, n = 5000) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff)

describe('simulated classifier', () => {
  it('is deterministic for the same photo', () => {
    const input = { image: bytes(7), mimeType: 'image/jpeg', fileName: 'IMG_0042.jpg' }
    expect(simulateClassification(input)).toEqual(simulateClassification(input))
  })

  it.each([
    ['sample-blocked-ramp.jpg', 'blocked_ramp'],
    ['parked-car.png', 'parked_vehicle'],
    ['flooded_path.jpg', 'flooding'],
    ['pothole.jpeg', 'broken_pavement'],
    ['no-kerb-cut.jpg', 'missing_kerb_cut'],
  ] as const)('uses file name hints: %s -> %s', (fileName, category) => {
    const result = simulateClassification({ image: bytes(1), mimeType: 'image/jpeg', fileName })
    expect(result.category).toBe(category)
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('guesses a blocked ramp on a ramp-shaped path', () => {
    const result = simulateClassification({
      image: bytes(3),
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      context: { stepFree: true, slopePct: 7, widthM: 1.4 },
    })
    expect(result.category).toBe('blocked_ramp')
  })

  it('returns a score for every category that sums to about 1, top score = suggestion', () => {
    const result = simulateClassification({ image: bytes(9), mimeType: 'image/jpeg', fileName: 'x.jpg' })
    expect(Object.keys(result.scores).sort()).toEqual([...CATEGORIES].sort())
    const sum = Object.values(result.scores).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 2)
    const top = Object.entries(result.scores).sort((a, b) => b[1] - a[1])[0][0]
    expect(top).toBe(result.category)
    expect(result.source).toBe('simulated')
  })
})
