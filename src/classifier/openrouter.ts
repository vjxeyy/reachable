// OpenRouter photo classifier: sends the photo to a free vision model and asks for one score per
// category as JSON. Server only (the key must never reach the browser). Needs a free OpenRouter key.
// Free models are rate-limited (about 20 requests/minute, 50/day without bought credits), so this is
// always wrapped in withFallback(): any problem ends in the simulated classifier.

import { CATEGORIES, type Category } from '../core/types'
import { normaliseScores } from './clip'
import type { Classifier, ClassifierResult, ClassifyInput } from './index'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1'

/** Free vision models, tried in this order by OpenRouter (it accepts up to three). */
export const DEFAULT_OPENROUTER_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
]

const PROMPT = `This photo was sent by someone reporting an accessibility barrier on a campus footpath, for wheelchair, crutch and low-vision users.

Score how well each category describes the main barrier in the photo, as a probability from 0 to 1. The six scores should add up to 1.

- blocked_ramp: a ramp that is closed, obstructed or unusable (barriers, cones, objects or works on it)
- parked_vehicle: a car, van, bike, scooter or other vehicle blocking the path
- flooding: standing water, puddles, mud or ice covering the path
- broken_pavement: potholes, cracks, uneven or missing paving, raised slabs
- missing_kerb_cut: a kerb or step with no dropped kerb or ramp to get past it
- other: any other barrier, or no clear barrier visible

Reply with only a JSON object, no other text, in exactly this form:
{"blocked_ramp":0.0,"parked_vehicle":0.0,"flooding":0.0,"broken_pavement":0.0,"missing_kerb_cut":0.0,"other":0.0}`

export interface OpenRouterOptions {
  apiKey: string
  /** One to three model ids. Default: DEFAULT_OPENROUTER_MODELS. */
  models?: string[]
  /** Per-request limit. Free models can be slow, so the default is generous. */
  timeoutMs?: number
  /** For tests: a local stand-in for https://openrouter.ai/api/v1. */
  baseUrl?: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Pulls the JSON object out of a model reply, even if it is wrapped in a code fence or chatter. */
export function parseScores(text: string): Record<Category, number> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('the answer had no JSON in it')
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('the answer was not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('the answer was not valid JSON')
  const raw = {} as Record<Category, number>
  let found = 0
  for (const category of CATEGORIES) {
    const value = Number((parsed as Record<string, unknown>)[category])
    if (Number.isFinite(value)) found++
    raw[category] = value
  }
  if (found < CATEGORIES.length) throw new Error('the answer was missing some categories')
  return raw
}

export function createOpenRouterClassifier(options: OpenRouterOptions): Classifier {
  const models = (options.models?.length ? options.models : DEFAULT_OPENROUTER_MODELS).slice(0, 3)
  const timeout = options.timeoutMs ?? 10_000
  const baseUrl = (options.baseUrl ?? OPENROUTER_URL).replace(/\/$/, '')

  return {
    name: `openrouter:${models[0]}`,
    async classify(input: ClassifyInput): Promise<ClassifierResult> {
      const mime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(input.mimeType) ? input.mimeType : 'image/jpeg'
      let response: Response
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'REACHABLE',
          },
          body: JSON.stringify({
            // `models` lets OpenRouter try the next free model if one is busy or down.
            models,
            max_tokens: 300,
            temperature: 0,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: `data:${mime};base64,${toBase64(input.image)}` } },
                  { type: 'text', text: PROMPT },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(timeout),
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') throw new Error('timed out')
        throw new Error('could not reach OpenRouter')
      }

      if (response.status === 401 || response.status === 403) throw new Error('the OpenRouter key was rejected')
      if (response.status === 402) throw new Error('the OpenRouter account has no credit')
      if (response.status === 429) throw new Error('rate limited (free models allow about 50 photos a day)')
      if (!response.ok) throw new Error(`OpenRouter error ${response.status}`)

      const body = (await response.json().catch(() => null)) as {
        model?: string
        error?: { message?: string }
        choices?: { message?: { content?: unknown } }[]
      } | null
      if (body?.error) throw new Error(body.error.message ?? 'OpenRouter returned an error')
      const content = body?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.trim() === '') throw new Error('the model sent an empty answer')

      const scores = normaliseScores(parseScores(content))
      const category = CATEGORIES.reduce((best, c) => (scores[c] > scores[best] ? c : best), CATEGORIES[0])
      return { category, confidence: scores[category], scores, source: 'real', model: body?.model ?? models[0] }
    },
  }
}
