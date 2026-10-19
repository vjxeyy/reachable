// Real photo classifier: Claude vision (claude-haiku-5-5) with structured output, one score per
// category. Server-side only: the API key is passed in by the server and never reaches the browser.
// Wrap it with withFallback() so a missing key, an error or a slow answer falls back to the
// simulated classifier.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod'
import { CATEGORIES, type Category } from '../core/types'
import type { Classifier, ClassifierResult, ClassifyInput } from './index'

export const REAL_MODEL = 'claude-haiku-5-5'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

const ScoresSchema = z.object({
  scores: z.object({
    blocked_ramp: z.number(),
    parked_vehicle: z.number(),
    flooding: z.number(),
    broken_pavement: z.number(),
    missing_kerb_cut: z.number(),
    other: z.number(),
  }),
})

const PROMPT = `This photo was sent by someone reporting an accessibility barrier on a campus footpath, for wheelchair, crutch and low-vision users.

Score how well each category describes the main barrier in the photo. Give each a probability from 0 to 1; together they should add up to 1.

- blocked_ramp: a ramp that is closed, obstructed or unusable (barriers, cones, objects or works on it)
- parked_vehicle: a car, van, bike, scooter or other vehicle blocking the path
- flooding: standing water, puddles, mud or ice covering the path
- broken_pavement: potholes, cracks, uneven or missing paving, raised slabs
- missing_kerb_cut: a kerb or step with no dropped kerb or ramp to get past it
- other: any other barrier, or no clear barrier visible`

/** The part of the Anthropic client this classifier uses, so tests can pass a stand-in. */
export type MessagesClient = Pick<Anthropic, 'messages'>

export interface RealClassifierOptions {
  apiKey: string
  /** Per-request timeout. The plan asks for 5 s; withFallback enforces it too. */
  timeoutMs?: number
  model?: string
  /** For tests only. */
  client?: MessagesClient
}

/** Clamps, normalises to a sum of 1 and rounds the model's scores. */
export function normaliseScores(raw: Record<Category, number>): Record<Category, number> {
  const clean = CATEGORIES.map((c) => (Number.isFinite(raw[c]) && raw[c] > 0 ? raw[c] : 0))
  const total = clean.reduce((a, b) => a + b, 0)
  const scores = {} as Record<Category, number>
  CATEGORIES.forEach((c, i) => {
    scores[c] = total > 0 ? Math.round((clean[i] / total) * 1000) / 1000 : c === 'other' ? 1 : 0
  })
  return scores
}

/** Base64 without Node's Buffer, so this file type-checks for both the server and the browser build. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function topCategory(scores: Record<Category, number>): Category {
  return CATEGORIES.reduce((best, c) => (scores[c] > scores[best] ? c : best), CATEGORIES[0])
}

function errorReason(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'the API key was rejected'
  if (error instanceof Anthropic.RateLimitError) return 'rate limited'
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timed out'
  if (error instanceof Anthropic.APIConnectionError) return 'could not reach the API'
  if (error instanceof Anthropic.APIError) return `API error ${error.status ?? ''}`.trim()
  return error instanceof Error ? error.message : 'unknown error'
}

export function createRealClassifier(options: RealClassifierOptions): Classifier {
  const model = options.model ?? REAL_MODEL
  const timeout = options.timeoutMs ?? 5000
  const client: MessagesClient = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout, maxRetries: 0 })

  return {
    name: model,
    async classify(input: ClassifyInput): Promise<ClassifierResult> {
      const mediaType: ImageType = (IMAGE_TYPES as readonly string[]).includes(input.mimeType)
        ? (input.mimeType as ImageType)
        : 'image/jpeg'
      let response
      try {
        response = await client.messages.parse(
          {
            model,
            max_tokens: 1024,
            output_config: { effort: 'low', format: zodOutputFormat(ScoresSchema) },
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: mediaType, data: toBase64(input.image) },
                  },
                  { type: 'text', text: PROMPT },
                ],
              },
            ],
          },
          { timeout, maxRetries: 0 },
        )
      } catch (error) {
        throw new Error(errorReason(error), { cause: error })
      }
      if (response.stop_reason === 'refusal') throw new Error('the model declined to classify this photo')
      if (response.stop_reason === 'max_tokens') throw new Error('the answer was cut off')
      if (!response.parsed_output) throw new Error('the answer was not valid JSON')

      const scores = normaliseScores(response.parsed_output.scores)
      const category = topCategory(scores)
      return { category, confidence: scores[category], scores, source: 'real', model }
    },
  }
}
