// CLIP zero-shot photo classifier: scores a photo against a short text description of each category.
// The model itself runs on the server (see server/clip-backend.ts); this file holds the labels and the
// mapping so it can be tested with a stand-in backend. Free: no API key and no account.

import { CATEGORIES, type Category } from '../core/types'
import type { Classifier, ClassifierResult, ClassifyInput } from './index'

export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32'

/**
 * What CLIP is asked to match, one sentence per category. The model completes "This is a photo of ...".
 * Wording matters: change it here and re-run `npm run clip:check` to see the effect on the samples.
 */
export const CLIP_LABELS: Record<Category, string> = {
  blocked_ramp: 'a ramp blocked by barriers, cones or objects',
  parked_vehicle: 'a car or vehicle parked across a footpath',
  flooding: 'a flooded footpath with standing water',
  broken_pavement: 'a broken, cracked or uneven pavement',
  missing_kerb_cut: 'a kerb or step with no dropped kerb or ramp',
  other: 'a footpath with some other obstacle',
}

export interface ClipScore {
  label: string
  score: number
}

/** Runs the model. The real one is server/clip-backend.ts; tests pass a stand-in. */
export interface ClipBackend {
  scoreImage(image: Uint8Array, mimeType: string, labels: string[]): Promise<ClipScore[]>
}

/** Clamps, normalises to a sum of 1 and rounds scores. */
export function normaliseScores(raw: Record<Category, number>): Record<Category, number> {
  const clean = CATEGORIES.map((c) => (Number.isFinite(raw[c]) && raw[c] > 0 ? raw[c] : 0))
  const total = clean.reduce((a, b) => a + b, 0)
  const scores = {} as Record<Category, number>
  CATEGORIES.forEach((c, i) => {
    scores[c] = total > 0 ? Math.round((clean[i] / total) * 1000) / 1000 : c === 'other' ? 1 : 0
  })
  return scores
}

export function createClipClassifier(backend: ClipBackend): Classifier {
  const labels = CATEGORIES.map((c) => CLIP_LABELS[c])
  return {
    name: 'clip',
    async classify(input: ClassifyInput): Promise<ClassifierResult> {
      const output = await backend.scoreImage(input.image, input.mimeType, labels)
      const raw = {} as Record<Category, number>
      for (const category of CATEGORIES) {
        const match = output.find((o) => o.label === CLIP_LABELS[category])
        if (!match) throw new Error('the model returned unexpected labels')
        raw[category] = match.score
      }
      const scores = normaliseScores(raw)
      const category = CATEGORIES.reduce((best, c) => (scores[c] > scores[best] ? c : best), CATEGORIES[0])
      return { category, confidence: scores[category], scores, source: 'real', model: 'clip-vit-base-patch32' }
    },
  }
}
