// Simulated photo classifier for the demo. Deterministic: the same photo always gets the same
// suggestion. It looks at the file name, the shape of the reported path and a hash of the image
// bytes. It does not look at the picture, which is why the UI labels it "AI suggestion (demo)".

import { CATEGORIES, type Category } from '../core/types'
import type { Classifier, ClassifierResult, ClassifyInput } from './index'

const KEYWORDS: [RegExp, Category][] = [
  [/ramp|slope|barrier/, 'blocked_ramp'],
  [/car|vehicle|parked|van|bike|scooter|truck/, 'parked_vehicle'],
  [/flood|water|puddle|rain/, 'flooding'],
  [/pothole|crack|broken|pavement|paving|uneven/, 'broken_pavement'],
  [/kerb|curb/, 'missing_kerb_cut'],
]

/** FNV-1a over the name and a sample of the bytes (fast on large photos). */
function hash(input: ClassifyInput): number {
  let h = 0x811c9dc5
  const mix = (byte: number) => {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (const ch of input.fileName ?? '') mix(ch.charCodeAt(0) & 0xff)
  const step = Math.max(1, Math.floor(input.image.length / 4096))
  for (let i = 0; i < input.image.length; i += step) mix(input.image[i])
  mix(input.image.length & 0xff)
  return h
}

/** Pseudo-random number in [0, 1) derived from the hash and a salt. */
function unit(h: number, salt: number): number {
  let x = (h ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x / 2 ** 32
}

export function simulateClassification(input: ClassifyInput): ClassifierResult {
  const h = hash(input)
  const name = (input.fileName ?? '').toLowerCase()
  const keyword = KEYWORDS.find(([pattern]) => pattern.test(name))?.[1]
  const ctx = input.context

  let category: Category
  let confidence: number
  if (keyword) {
    category = keyword
    confidence = 0.84 + unit(h, 1) * 0.1
  } else if (ctx && ctx.stepFree && ctx.slopePct >= 5) {
    category = 'blocked_ramp'
    confidence = 0.58 + unit(h, 2) * 0.12
  } else {
    const guesses: Category[] = ['broken_pavement', 'parked_vehicle', 'flooding', 'other']
    category = guesses[Math.floor(unit(h, 3) * guesses.length)]
    confidence = 0.42 + unit(h, 4) * 0.16
  }

  // Share the remaining probability among the other categories.
  const others = CATEGORIES.filter((c) => c !== category)
  const weights = others.map((_, i) => 0.2 + unit(h, 10 + i))
  const total = weights.reduce((a, b) => a + b, 0)
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  scores[category] = round(confidence)
  others.forEach((c, i) => {
    scores[c] = round(((1 - confidence) * weights[i]) / total)
  })
  return { category, confidence: scores[category], scores, source: 'simulated', model: 'simulated-v1' }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Creates a simulated classifier. `delayMs` mimics model latency so the UI shows its loading state. */
export function createSimulatedClassifier(delayMs = 0): Classifier {
  return {
    name: 'simulated',
    async classify(input) {
      if (delayMs > 0) await wait(delayMs)
      return simulateClassification(input)
    },
  }
}

export const simulatedClassifier = createSimulatedClassifier()
