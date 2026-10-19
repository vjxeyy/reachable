// Picks the photo classifier from environment variables. The result is always wrapped with the
// simulated classifier as a fallback, so a missing key or a failing model never breaks reporting.
//
//   CLASSIFIER=openrouter  (or just set OPENROUTER_API_KEY)  free vision model via OpenRouter
//   CLASSIFIER=clip                                          CLIP on this machine (needs ~400-500 MB)
//   CLASSIFIER=simulated                                     demo classifier only

import { withFallback, type Classifier } from '../src/classifier'
import { createClipClassifier } from '../src/classifier/clip'
import { createOpenRouterClassifier } from '../src/classifier/openrouter'
import { simulatedClassifier } from '../src/classifier/simulated'
import { createClipRuntime, type ClipRuntime } from './clip-backend'

export type ClassifierKind = 'openrouter' | 'clip' | 'simulated'

export interface ClassifierEnv {
  CLASSIFIER?: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  MODEL_CACHE_DIR?: string
}

export function chooseKind(env: ClassifierEnv): ClassifierKind {
  const wanted = env.CLASSIFIER?.trim().toLowerCase()
  if (wanted === 'clip') return 'clip'
  if (wanted === 'simulated' || wanted === 'demo' || wanted === 'off') return 'simulated'
  if (wanted === 'openrouter' || env.OPENROUTER_API_KEY?.trim()) return 'openrouter'
  return 'simulated'
}

export interface ServerClassifier {
  classifier: Classifier
  kind: ClassifierKind
  /** One line for the start-up log. */
  description: string
  /** CLIP only: loads the model now so the first photo is fast. */
  clipRuntime?: ClipRuntime
}

export function buildServerClassifier(env: ClassifierEnv, defaultCacheDir: string): ServerClassifier {
  const kind = chooseKind(env)

  if (kind === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY?.trim()
    if (!apiKey) {
      return {
        kind: 'simulated',
        description: 'Photo classifier: demo (CLASSIFIER=openrouter but OPENROUTER_API_KEY is not set)',
        classifier: withFallback(null, simulatedClassifier, {
          timeoutMs: 10_000,
          missingNote: 'Demo classifier: OPENROUTER_API_KEY is not set on the server.',
        }),
      }
    }
    const models = env.OPENROUTER_MODEL?.split(',')
      .map((m) => m.trim())
      .filter(Boolean)
    const primary = createOpenRouterClassifier({ apiKey, models, timeoutMs: 9000 })
    return {
      kind,
      description: `Photo classifier: OpenRouter ${primary.name.replace('openrouter:', '')} (falls back to the demo classifier)`,
      classifier: withFallback(primary, simulatedClassifier, { timeoutMs: 10_000, failurePrefix: 'OpenRouter unavailable' }),
    }
  }

  if (kind === 'clip') {
    const runtime = createClipRuntime(env.MODEL_CACHE_DIR ?? defaultCacheDir)
    return {
      kind,
      clipRuntime: runtime,
      description: 'Photo classifier: CLIP (loading; falls back to the demo classifier)',
      classifier: withFallback(createClipClassifier(runtime), simulatedClassifier, {
        timeoutMs: 5000,
        failurePrefix: 'CLIP model unavailable',
      }),
    }
  }

  return {
    kind,
    description: 'Photo classifier: demo (set OPENROUTER_API_KEY or CLASSIFIER=clip for a real model)',
    classifier: withFallback(null, simulatedClassifier, {
      timeoutMs: 5000,
      missingNote: 'Demo classifier. Set OPENROUTER_API_KEY (or CLASSIFIER=clip) on the server to use a real image model.',
    }),
  }
}
