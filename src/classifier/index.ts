// Photo classifier interface. Every implementation (simulated, real model) returns the same shape,
// so the UI and server can swap them freely and always fall back to the simulated one.

import type { Category } from '../core/types'
import { createSimulatedClassifier, simulatedClassifier } from './simulated'

export interface ClassifyInput {
  image: Uint8Array
  mimeType: string
  fileName?: string
  /** Shape of the reported path. The simulated classifier uses it to make a plausible guess. */
  context?: { stepFree: boolean; slopePct: number; widthM: number }
}

export interface ClassifierResult {
  /** Suggested category, the highest score. */
  category: Category
  /** Confidence (0 to 1) in the suggested category. */
  confidence: number
  /** A score per category, summing to about 1, so a corrected category still has a confidence. */
  scores: Record<Category, number>
  /** `simulated` must be labelled "AI suggestion (demo)" on screen. */
  source: 'simulated' | 'real'
  model: string
  /** Why a fallback happened, if it did. */
  note?: string
}

export interface Classifier {
  readonly name: string
  classify(input: ClassifyInput): Promise<ClassifierResult>
}

export { simulatedClassifier }

// A short delay so the "Analysing photo" state is visible, like a real model call.
const browserSimulated = createSimulatedClassifier(700)

/** The classifier the browser uses. Phase 6/7 swap in the server's real model with fallback. */
export function getClassifier(): Classifier {
  return browserSimulated
}
