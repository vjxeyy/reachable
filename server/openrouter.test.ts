// The OpenRouter classifier is tested against a local stand-in server (127.0.0.1): no key, no internet.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withFallback } from '../src/classifier'
import { createOpenRouterClassifier, DEFAULT_OPENROUTER_MODELS, parseScores } from '../src/classifier/openrouter'
import { simulatedClassifier } from '../src/classifier/simulated'

const input = { image: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/jpeg', fileName: 'IMG_1.jpg' }
const SCORES = { blocked_ramp: 0.05, parked_vehicle: 0.8, flooding: 0.05, broken_pavement: 0.05, missing_kerb_cut: 0.03, other: 0.02 }

type Reply = { status?: number; delayMs?: number; json: unknown }

let server: Server
let baseUrl: string
let reply: Reply
/** When set, replaces `reply` for the Nth request of a test (0 = first). */
let replies: Reply[] | null = null
let requests: Record<string, unknown>[] = []
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
      requests.push(seen.body)
      const r = replies ? (replies[requests.length - 1] ?? replies[replies.length - 1]) : reply
      setTimeout(() => {
        res.writeHead(r.status ?? 200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(r.json))
      }, r.delayMs ?? 0)
    })
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  replies = null
  requests = []
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
      model: string
      max_tokens: number
      messages: { role: string; content: { type: string; image_url?: { url: string }; text?: string }[] }[]
    }
    expect(body.model).toBe(DEFAULT_OPENROUTER_MODELS[0])
    expect(DEFAULT_OPENROUTER_MODELS.every((m) => m.endsWith(':free'))).toBe(true)
    // Room for a reasoning model to think and still write the JSON (300 left an empty answer).
    expect(body.max_tokens).toBeGreaterThanOrEqual(1000)
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

  it('tries the next model when one sends an empty answer, and uses at most three', async () => {
    replies = [completion(''), { status: 500, json: {} }, completion(JSON.stringify(SCORES), 'c:free')]
    const result = await make({ models: ['a:free', 'b:free', 'c:free', 'd:free'] }).classify(input)
    expect(requests.map((r) => r.model)).toEqual(['a:free', 'b:free', 'c:free'])
    expect(result).toMatchObject({ source: 'real', model: 'c:free' })
  })

  it('stops at once on a rejected key or the daily limit instead of trying more models', async () => {
    replies = [{ status: 429, json: { error: { message: 'Rate limit exceeded: free-models-per-day' } } }, completion(JSON.stringify(SCORES))]
    await expect(make({ models: ['a:free', 'b:free'] }).classify(input)).rejects.toThrow(/rate limited \(Rate limit exceeded: free-models-per-day\)/)
    expect(requests).toHaveLength(1)
    replies = [{ status: 401, json: {} }, completion(JSON.stringify(SCORES))]
    requests = []
    await expect(make({ models: ['a:free', 'b:free'] }).classify(input)).rejects.toThrow(/key was rejected/)
    expect(requests).toHaveLength(1)
  })

  it('tries the next model when one is busy upstream (a 429 that is not the daily limit)', async () => {
    replies = [{ status: 429, json: { error: { message: 'a:free is temporarily rate-limited upstream' } } }, completion(JSON.stringify(SCORES), 'b:free')]
    const result = await make({ models: ['a:free', 'b:free'] }).classify(input)
    expect(requests).toHaveLength(2)
    expect(result.model).toBe('b:free')
  })

  it('says what every model did when none gives a usable answer', async () => {
    replies = [completion(''), completion('I cannot tell.')]
    await expect(make({ models: ['x/a:free', 'x/b:free'] }).classify(input)).rejects.toThrow(/a: the model sent an empty answer.*b: the answer had no JSON/)
  })

  it('reads an answer sent as a list of text parts, or left in the reasoning text', async () => {
    reply = completion([{ type: 'text', text: JSON.stringify(SCORES) }])
    expect((await make().classify(input)).category).toBe('parked_vehicle')
    reply = { json: { model: 'm:free', choices: [{ message: { content: '', reasoning: 'Thinking... ' + JSON.stringify(SCORES) } }] } }
    expect((await make().classify(input)).category).toBe('parked_vehicle')
  })

  it('names why an empty answer was empty', async () => {
    reply = { json: { model: 'm:free', choices: [{ finish_reason: 'length', message: { content: null } }] } }
    await expect(make().classify(input)).rejects.toThrow(/empty answer \(stopped: length\)/)
  })

  it.each([
    ['a rejected key', { status: 401, json: { error: { message: 'No auth' } } }, /key was rejected/],
    ['no credit', { status: 402, json: { error: { message: 'x' } } }, /no credit/],
    ['a rate limit', { status: 429, json: { error: { message: 'x' } } }, /rate limited \(x\)/],
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
    expect(limited.note).toMatch(/OpenRouter unavailable \(.*rate limited/)

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
