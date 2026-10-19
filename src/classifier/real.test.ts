// The real classifier is tested with a stand-in client: no network, no API key.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withFallback, type Classifier } from './index'
import { createRealClassifier, normaliseScores, type MessagesClient } from './real'
import { simulatedClassifier } from './simulated'

const input = { image: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/jpeg', fileName: 'IMG_1.jpg' }

function fakeClient(response: unknown, calls: unknown[] = []): MessagesClient {
  return {
    messages: {
      parse: async (params: unknown) => {
        calls.push(params)
        if (response instanceof Error) throw response
        return response
      },
    },
  } as unknown as MessagesClient
}

const answer = (scores: Record<string, number>, stop_reason = 'end_turn') => ({
  stop_reason,
  parsed_output: { scores },
})

describe('real classifier (Claude vision)', () => {
  it('sends the photo as a base64 image to claude-haiku-5-5 with structured output', async () => {
    const calls: Record<string, unknown>[] = []
    const classifier = createRealClassifier({
      apiKey: 'test',
      client: fakeClient(
        answer({ blocked_ramp: 8, parked_vehicle: 1, flooding: 0, broken_pavement: 0, missing_kerb_cut: 1, other: 0 }),
        calls,
      ),
    })
    const result = await classifier.classify(input)
    expect(result).toMatchObject({ category: 'blocked_ramp', confidence: 0.8, source: 'real', model: 'claude-haiku-5-5' })
    expect(Object.values(result.scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)

    const params = calls[0] as {
      model: string
      output_config: { effort: string; format: unknown }
      messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[]
    }
    expect(params.model).toBe('claude-haiku-5-5')
    expect(params.output_config.effort).toBe('low')
    expect(params.output_config.format).toBeTruthy()
    const image = params.messages[0].content[0]
    expect(image.type).toBe('image')
    expect(image.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: btoa('\x01\x02\x03\x04') })
  })

  it.each([
    ['a refusal', answer({}, 'refusal'), /declined/],
    ['a cut-off answer', answer({}, 'max_tokens'), /cut off/],
    ['an unparsable answer', { stop_reason: 'end_turn', parsed_output: null }, /not valid JSON/],
    ['a network error', new Error('socket hang up'), /socket hang up/],
  ])('throws on %s so the fallback takes over', async (_name, response, message) => {
    const classifier = createRealClassifier({ apiKey: 'test', client: fakeClient(response) })
    await expect(classifier.classify(input)).rejects.toThrow(message)
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
  const failing: Classifier = { name: 'broken', classify: async () => Promise.reject(new Error('the API key was rejected')) }
  const hanging: Classifier = { name: 'slow', classify: () => new Promise(() => {}) }
  const working: Classifier = {
    name: 'good',
    classify: async () => ({ ...(await simulatedClassifier.classify(input)), source: 'real' as const, model: 'good' }),
  }

  it('uses the simulated classifier with a note when there is no key', async () => {
    const result = await withFallback(null, simulatedClassifier, { timeoutMs: 5000, missingNote: 'No key' }).classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toBe('No key')
  })

  it('falls back when the model fails', async () => {
    const result = await withFallback(failing, simulatedClassifier, { timeoutMs: 5000 }).classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toMatch(/API key was rejected/)
  })

  it('falls back when the model is too slow', async () => {
    const result = await withFallback(hanging, simulatedClassifier, { timeoutMs: 30 }).classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toMatch(/no answer within 0.03 s/)
  })

  it('passes a good answer through untouched', async () => {
    const result = await withFallback(working, simulatedClassifier, { timeoutMs: 5000 }).classify(input)
    expect(result.source).toBe('real')
    expect(result.note).toBeUndefined()
  })
})

describe('real classifier through the real SDK, against a local stub of the Messages API', () => {
  // Nothing leaves this machine: ANTHROPIC_BASE_URL points the SDK at 127.0.0.1.
  let server: Server
  let lastBody: Record<string, unknown> | null = null
  let delayMs = 0
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        lastBody = JSON.parse(raw)
        const scores = { blocked_ramp: 0.1, parked_vehicle: 0.7, flooding: 0.05, broken_pavement: 0.05, missing_kerb_cut: 0.05, other: 0.05 }
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              model: 'claude-haiku-5-5',
              content: [{ type: 'text', text: JSON.stringify({ scores }) }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 20 },
            }),
          )
        }, delayMs)
      })
    })
    server.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = savedBaseUrl
  })

  it('builds a valid request and parses the structured answer', async () => {
    delayMs = 0
    const result = await createRealClassifier({ apiKey: 'test-key' }).classify(input)
    expect(result).toMatchObject({ category: 'parked_vehicle', confidence: 0.7, source: 'real' })
    const body = lastBody as {
      model: string
      output_config: { effort: string; format: { type: string; schema: { properties: Record<string, unknown> } } }
      messages: { content: { type: string }[] }[]
    }
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.output_config.effort).toBe('low')
    expect(body.output_config.format.type).toBe('json_schema')
    expect(Object.keys(body.output_config.format.schema.properties)).toEqual(['scores'])
    expect(body.messages[0].content.map((c) => c.type)).toEqual(['image', 'text'])
  })

  it('gives up after the timeout so the fallback can answer', async () => {
    delayMs = 1500
    const classifier = withFallback(createRealClassifier({ apiKey: 'test-key', timeoutMs: 300 }), simulatedClassifier, {
      timeoutMs: 5000,
    })
    const result = await classifier.classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toMatch(/timed out/)
  })
})
