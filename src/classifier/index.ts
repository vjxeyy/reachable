// Photo classifier interface. Every implementation (simulated, real model) returns the same shape,
// so the UI and server can swap them freely and always fall back to the simulated one.
// This file stays free of browser and Node specifics: the server and the browser both import it.

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

export interface FallbackOptions {
  /** Give up on the primary classifier after this long (PLAN.md: 5 s). */
  timeoutMs: number
  /** Note shown when there is no primary classifier (e.g. no API key). */
  missingNote?: string
  /** Prefix for the note when the primary fails, e.g. "Real model unavailable". */
  failurePrefix?: string
}

/**
 * Uses `primary` when it answers in time, otherwise `fallback`. Never throws because of the
 * primary: a missing classifier, an error or a timeout all end in the fallback's answer with a note.
 */
export function withFallback(primary: Classifier | null, fallback: Classifier, options: FallbackOptions): Classifier {
  const prefix = options.failurePrefix ?? 'AI model unavailable'
  return {
    name: primary ? `${primary.name} (falls back to ${fallback.name})` : fallback.name,
    async classify(input) {
      if (!primary) {
        const result = await fallback.classify(input)
        return options.missingNote ? { ...result, note: options.missingNote } : result
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${options.timeoutMs / 1000} s`)), options.timeoutMs)
      })
      try {
        return await Promise.race([primary.classify(input), timeout])
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error'
        const result = await fallback.classify(input)
        return { ...result, note: `${prefix} (${reason}). Showing the demo suggestion instead.` }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

// ---------- Browser selection ----------

// A short delay so the "Analysing photo" state is visible, like a real model call.
const browserSimulated = createSimulatedClassifier(700)

/** The server's /api/classify, registered by the store while the server is reachable. */
let remote: Classifier | null = null

export function setRemoteClassifier(classifier: Classifier | null): void {
  remote = classifier
}

/**
 * The classifier the browser uses: the server (real model with its own fallback) when it is
 * reachable, otherwise the simulated classifier right here in the browser.
 */
export function getClassifier(): Classifier {
  if (!remote) return browserSimulated
  return withFallback(remote, browserSimulated, { timeoutMs: 13_000, failurePrefix: 'Server classifier unavailable' })
}
