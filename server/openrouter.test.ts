// The OpenRouter classifier is tested against a local stand-in server (127.0.0.1): no key, no internet.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withFallback } from '../src/classifier'
import { createOpenRouterClassifier, DEFAULT_OPENROUTER_MODELS, parseScores } from '../src/classifier/openrouter'
import { simulatedClassifier } from '../src/classifier/simulated'

const input = { image: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/jpeg', fileName: 'IMG_1.jpg' }
const SCORES = { blocked_ramp: 0.05, parked_vehicle: 0.8, flooding: 0.05, broken_pavement: 0.05, missing_kerb_cut: 0.03, other: 0.02 }

type Reply = { status?: number; delayMs?: number; json: unknown }

let server: Server
let baseUrl: string
let reply: Reply
let seen: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | null = null

const completion = (content: unknown, model = 'google/gemma-4-26b-a4b-it:free') => ({
  json: { id: 'gen-1', model, choices: [{ message: { role: 'assistant', content } }] },
})

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      seen = { headers: req.headers, body: JSON.parse(raw) }
      setTimeout(() => {
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(reply.json))
      }, reply.delayMs ?? 0)
    })
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

const make = (extra = {}) => createOpenRouterClassifier({ apiKey: 'test-key', baseUrl, ...extra })

describe('OpenRouter classifier', () => {
  it('sends the photo as an image and asks for JSON scores, with the key and free models', async () => {
    reply = completion(JSON.stringify(SCORES))
    const result = await make().classify(input)
    expect(result).toMatchObject({ category: 'parked_vehicle', confidence: 0.8, source: 'real', model: 'google/gemma-4-26b-a4b-it:free' })
    expect(Object.values(result.scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)

    expect(seen!.headers.authorization).toBe('Bearer test-key')
    const body = seen!.body as {
      models: string[]
      messages: { role: string; content: { type: string; image_url?: { url: string }; text?: string }[] }[]
    }
    expect(body.models).toEqual(DEFAULT_OPENROUTER_MODELS)
    expect(body.models.every((m) => m.endsWith(':free'))).toBe(true)
    const [image, text] = body.messages[0].content
    expect(image.image_url!.url).toBe(`data:image/jpeg;base64,${btoa('\x01\x02\x03\x04')}`)
    expect(text.text).toContain('blocked_ramp')
    expect(text.text).toContain('JSON')
  })

  it('reports the model that actually answered', async () => {
    reply = completion(JSON.stringify(SCORES), 'nvidia/nemotron-3.5-super-vl:free')
    expect((await make().classify(input)).model).toBe('nvidia/nemotron-3.5-super-vl:free')
  })

  it('accepts JSON wrapped in a code fence or chatter', async () => {
    reply = completion('Sure! Here you go:\n```json\n' + JSON.stringify(SCORES) + '\n```')
    expect((await make().classify(input)).category).toBe('parked_vehicle')
  })

  it('uses a custom model list, at most three', async () => {
    reply = completion(JSON.stringify(SCORES))
    await make({ models: ['a:free', 'b:free', 'c:free', 'd:free'] }).classify(input)
    expect((seen!.body as { models: string[] }).models).toEqual(['a:free', 'b:free', 'c:free'])
  })

  it.each([
    ['a rejected key', { status: 401, json: { error: { message: 'No auth' } } }, /key was rejected/],
    ['no credit', { status: 402, json: { error: { message: 'x' } } }, /no credit/],
    ['the daily free limit', { status: 429, json: { error: { message: 'x' } } }, /rate limited/],
    ['a server error', { status: 500, json: {} }, /OpenRouter error 500/],
    ['an error object in a 200', { json: { error: { message: 'Provider returned error' } } }, /Provider returned error/],
    ['an empty answer', completion('   '), /empty answer/],
    ['an answer with no JSON', completion('I cannot tell.'), /no JSON/],
    ['broken JSON', completion('{"blocked_ramp": 0.5,}'), /not valid JSON/],
    ['missing categories', completion('{"flooding": 1}'), /missing some categories/],
  ] as [string, Reply, RegExp][])('throws on %s so the fallback takes over', async (_name, r, message) => {
    reply = r
    await expect(make().classify(input)).rejects.toThrow(message)
  })

  it('falls back to the simulated classifier with the reason when it fails or is too slow', async () => {
    reply = { status: 429, json: {} }
    const limited = await withFallback(make(), simulatedClassifier, { timeoutMs: 5000, failurePrefix: 'OpenRouter unavailable' }).classify(input)
    expect(limited.source).toBe('simulated')
    expect(limited.note).toMatch(/OpenRouter unavailable \(rate limited/)

    reply = { ...completion(JSON.stringify(SCORES)), delayMs: 1500 }
    const slow = await withFallback(make({ timeoutMs: 200 }), simulatedClassifier, { timeoutMs: 5000 }).classify(input)
    expect(slow.source).toBe('simulated')
    expect(slow.note).toMatch(/timed out/)
  })

  it('falls back when OpenRouter cannot be reached', async () => {
    const result = await withFallback(
      createOpenRouterClassifier({ apiKey: 'k', baseUrl: 'http://127.0.0.1:1' }),
      simulatedClassifier,
      { timeoutMs: 5000 },
    ).classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toMatch(/could not reach OpenRouter/)
  })
})

describe('parseScores', () => {
  it('reads all six categories', () => {
    expect(parseScores(JSON.stringify(SCORES)).parked_vehicle).toBe(0.8)
  })
})
