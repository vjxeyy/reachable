// The CLIP classifier is tested with a stand-in backend: no model download, no network.

import { describe, expect, it } from 'vitest'
import { CATEGORIES, type Category } from '../core/types'
import { CLIP_LABELS, createClipClassifier, normaliseScores, type ClipBackend } from './clip'
import { withFallback, type Classifier } from './index'
import { simulatedClassifier } from './simulated'

const input = { image: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/jpeg', fileName: 'IMG_1.jpg' }

/** A backend that "sees" the given scores, in a shuffled order like the real model's sorted output. */
function backendWith(scores: Partial<Record<Category, number>>, calls: unknown[][] = []): ClipBackend {
  return {
    scoreImage: async (...args) => {
      calls.push(args)
      return CATEGORIES.map((c) => ({ label: CLIP_LABELS[c], score: scores[c] ?? 0 })).sort((a, b) => b.score - a.score)
    },
  }
}

describe('CLIP classifier', () => {
  it('sends the photo and one description per category, and maps the scores back', async () => {
    const calls: unknown[][] = []
    const result = await createClipClassifier(backendWith({ flooding: 0.84, blocked_ramp: 0.06, missing_kerb_cut: 0.1 }, calls)).classify(input)
    expect(result).toMatchObject({ category: 'flooding', confidence: 0.84, source: 'real', model: 'clip-vit-base-patch32' })
    expect(result.scores.blocked_ramp).toBe(0.06)
    expect(Object.values(result.scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)
    const [image, mime, labels] = calls[0] as [Uint8Array, string, string[]]
    expect([...image]).toEqual([1, 2, 3, 4])
    expect(mime).toBe('image/jpeg')
    expect(labels).toEqual(CATEGORIES.map((c) => CLIP_LABELS[c]))
  })

  it('throws if the model returns labels it was not asked about', async () => {
    const backend: ClipBackend = { scoreImage: async () => [{ label: 'something else', score: 1 }] }
    await expect(createClipClassifier(backend).classify(input)).rejects.toThrow(/unexpected labels/)
  })

  it('normalises odd scores', () => {
    expect(normaliseScores({ blocked_ramp: -1, parked_vehicle: 2, flooding: 2, broken_pavement: NaN, missing_kerb_cut: 0, other: 0 })).toEqual({
      blocked_ramp: 0,
      parked_vehicle: 0.5,
      flooding: 0.5,
      broken_pavement: 0,
      missing_kerb_cut: 0,
      other: 0,
    })
    expect(normaliseScores({ blocked_ramp: 0, parked_vehicle: 0, flooding: 0, broken_pavement: 0, missing_kerb_cut: 0, other: 0 }).other).toBe(1)
  })
})

describe('withFallback', () => {
  const failing: Classifier = { name: 'broken', classify: async () => Promise.reject(new Error('model failed to load')) }
  const hanging: Classifier = { name: 'slow', classify: () => new Promise(() => {}) }
  const working = createClipClassifier(backendWith({ parked_vehicle: 0.7, other: 0.3 }))

  it('uses the simulated classifier with a note when CLIP is off', async () => {
    const result = await withFallback(null, simulatedClassifier, { timeoutMs: 5000, missingNote: 'CLIP is off' }).classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toBe('CLIP is off')
  })

  it('falls back when the model fails', async () => {
    const result = await withFallback(failing, simulatedClassifier, { timeoutMs: 5000 }).classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toMatch(/model failed to load/)
  })

  it('falls back when the model is too slow (for example still loading)', async () => {
    const result = await withFallback(hanging, simulatedClassifier, { timeoutMs: 30 }).classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toMatch(/no answer within 0.03 s/)
  })

  it('passes a good answer through untouched', async () => {
    const result = await withFallback(working, simulatedClassifier, { timeoutMs: 5000 }).classify(input)
    expect(result).toMatchObject({ source: 'real', category: 'parked_vehicle' })
    expect(result.note).toBeUndefined()
  })
})
