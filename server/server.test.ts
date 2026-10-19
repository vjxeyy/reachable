// API tests. They only ever use an in-memory database and a temporary uploads folder.

import type { Server } from 'node:http'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import campusData from '../data/campus.json'
import { loadCampus } from '../src/core/graph'
import type { RouteResult } from '../src/core/route'
import type { Report } from '../src/core/types'
import { DEFAULT_DB_PATH, deleteAreaReports, openDb, seedCampus, type DB } from './db'
import { buildServerClassifier } from './classifier-config'
import { createApp } from './index'
import { seedDemoIfNew } from './routes/demo'

const campus = loadCampus(campusData)
let db: DB
let server: Server
let base: string
let uploadsDir: string

beforeAll(async () => {
  db = openDb(':memory:')
  seedCampus(db, campus)
  uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'reachable-test-uploads-'))
  // No real classifier in tests: the classifier must fall back to the simulated one.
  const app = createApp({ db, campus, uploadsDir, classifier: buildServerClassifier({}, uploadsDir).classifier })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.close()
  db?.close()
  rmSync(uploadsDir, { recursive: true, force: true })
})

beforeEach(() => {
  deleteAreaReports(db, campus.areaId)
})

async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(base + url, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: (await response.json()) as T }
}

const newReport = (overrides: Record<string, unknown> = {}) => ({
  pathId: 'p-canteen-hostel-ramp',
  category: 'blocked_ramp',
  severity: 'blocked',
  confidence: 0.9,
  aiCategory: 'blocked_ramp',
  reporterId: 'device-a',
  description: 'Barrier across the ramp',
  ...overrides,
})

const route = (query = 'from=library&to=hostel&profile=wheelchair') => api<RouteResult>('GET', `/api/route?${query}`)

describe('safety guard', () => {
  it('refuses to open a database file while testing', () => {
    expect(() => openDb(DEFAULT_DB_PATH)).toThrow(/Refusing/)
    expect(() => openDb(path.join(os.tmpdir(), 'x.db'))).toThrow(/Refusing/)
  })
})

describe('API', () => {
  it('reports health and serves the campus', async () => {
    expect((await api('GET', '/api/health')).data).toMatchObject({ ok: true, areaId: 'ashgrove' })
    const campusRes = await api<{ nodes: unknown[] }>('GET', '/api/campus')
    expect(campusRes.data.nodes).toHaveLength(campus.nodes.length)
  })

  it('creates a report and lists it with a derived status', async () => {
    const created = await api<{ report: Report }>('POST', '/api/reports', newReport())
    expect(created.status).toBe(201)
    expect(created.data.report).toMatchObject({ pathId: 'p-canteen-hostel-ramp', status: 'unverified', photoUrl: null })
    const list = await api<{ reports: Report[] }>('GET', '/api/reports')
    expect(list.data.reports.map((r) => r.id)).toEqual([created.data.report.id])
  })

  it('stores an uploaded photo in the uploads folder and serves it', async () => {
    const form = new FormData()
    for (const [key, value] of Object.entries(newReport())) form.append(key, String(value))
    form.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'ramp.jpg')
    const created = await api<{ report: Report }>('POST', '/api/reports', form)
    expect(created.status).toBe(201)
    const url = created.data.report.photoUrl!
    expect(url).toMatch(/^\/uploads\/r-.*\.jpg$/)
    expect(readdirSync(uploadsDir)).toContain(path.basename(url))
    const photo = await fetch(base + url)
    expect(photo.status).toBe(200)
  })

  it('rejects invalid reports', async () => {
    expect((await api('POST', '/api/reports', newReport({ pathId: 'nope' }))).status).toBe(400)
    expect((await api('POST', '/api/reports', newReport({ category: 'lava' }))).status).toBe(400)
    expect((await api('POST', '/api/reports', newReport({ confidence: 3 }))).status).toBe(400)
    expect((await api('POST', '/api/reports', newReport({ reporterId: '' }))).status).toBe(400)
    const form = new FormData()
    for (const [key, value] of Object.entries(newReport())) form.append(key, String(value))
    form.append('photo', new Blob(['hello'], { type: 'text/plain' }), 'x.txt')
    expect((await api('POST', '/api/reports', form)).status).toBe(400)
  })

  it('needs two independent confirmations to verify, and the reporter cannot confirm', async () => {
    const { data } = await api<{ report: Report }>('POST', '/api/reports', newReport())
    const id = data.report.id
    const own = await api<{ error: string }>('POST', `/api/reports/${id}/confirm`, { voterId: 'device-a' })
    expect(own.status).toBe(409)
    expect(own.data.error).toMatch(/You reported this/)
    await api('POST', `/api/reports/${id}/confirm`, { voterId: 'device-b' })
    const second = await api<{ reports: Report[] }>('POST', `/api/reports/${id}/confirm`, { voterId: 'device-c' })
    expect(second.status).toBe(200)
    expect(second.data.reports[0].status).toBe('verified')
    expect((await api('POST', `/api/reports/does-not-exist/confirm`, { voterId: 'x' })).status).toBe(404)
  })

  it('GET /route reroutes around a block and restores the route when it is cleared', async () => {
    const before = await route()
    expect(before.data.status).toBe('ok')
    const usual = before.data.status === 'ok' ? before.data.route.pathIds : []
    expect(usual).toContain('p-canteen-hostel-ramp')

    const { data } = await api<{ report: Report }>('POST', '/api/reports', newReport())
    const during = await route()
    expect(during.data.status === 'ok' && during.data.route.pathIds).not.toContain('p-canteen-hostel-ramp')

    await api('POST', `/api/reports/${data.report.id}/clear`, { voterId: 'device-b' })
    expect((await route()).data).toEqual(before.data)
  })

  it('admin verify makes a hard block; admin resolve clears it', async () => {
    const { data } = await api<{ report: Report }>(
      'POST',
      '/api/reports',
      newReport({ pathId: 'p-lecture-health-ramp' }),
    )
    const unverified = await route('from=gate&to=health&profile=wheelchair')
    expect(unverified.data.status === 'no_verified_route' && unverified.data.alternative).toBeTruthy()

    await api('POST', `/api/reports/${data.report.id}/verify`, {})
    const verified = await route('from=gate&to=health&profile=wheelchair')
    expect(verified.data.status).toBe('no_verified_route')
    expect(verified.data.status === 'no_verified_route' && verified.data.alternative).toBeNull()

    await api('POST', `/api/reports/${data.report.id}/resolve`, {})
    expect((await route('from=gate&to=health&profile=wheelchair')).data.status).toBe('ok')
  })

  it('uses the client demo clock: a parked vehicle is outdated 6 hours later', async () => {
    await api('POST', '/api/reports', newReport({ category: 'parked_vehicle', pathId: 'p-gate-quad' }))
    const later = Date.now() + 6 * 60 * 60 * 1000
    const list = await api<{ reports: Report[] }>('GET', `/api/reports?at=${later}`)
    expect(list.data.reports[0].status).toBe('outdated')
  })

  it('validates route queries and unknown API paths', async () => {
    expect((await route('from=library&to=nowhere')).status).toBe(400)
    expect((await route('from=library&to=hostel&profile=jetpack')).status).toBe(400)
    expect((await api('GET', '/api/nothing-here')).status).toBe(404)
  })

  it('classifies a photo with the demo classifier when no real model is configured', async () => {
    const form = new FormData()
    form.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'sample-blocked-ramp.jpg')
    form.append('context', JSON.stringify({ stepFree: true, slopePct: 7, widthM: 1.4 }))
    const result = await api<{ category: string; source: string; note: string }>('POST', '/api/classify', form)
    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({ category: 'blocked_ramp', source: 'simulated' })
    expect(result.data.note).toMatch(/OPENROUTER_API_KEY/)
    expect((await api('POST', '/api/classify', new FormData())).status).toBe(400)
  })

  it('Reset demo deletes all reports and their photos, then restores the example reports', async () => {
    const form = new FormData()
    for (const [key, value] of Object.entries(newReport())) form.append(key, String(value))
    form.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'ramp.jpg')
    const created = await api<{ report: Report }>('POST', '/api/reports', form)
    const photoFile = path.basename(created.data.report.photoUrl!)
    expect(readdirSync(uploadsDir)).toContain(photoFile)

    const reset = await api<{ reports: Report[] }>('POST', '/api/demo/reset', { at: Date.now() })
    expect(reset.status).toBe(200)
    expect(reset.data.reports.map((r) => r.id).sort()).toEqual(
      ['seed-flooding', 'seed-kerb', 'seed-parked-van', 'seed-raised-slabs'],
    )
    expect(readdirSync(uploadsDir)).not.toContain(photoFile)
  })

  it('loads the example reports only once into a new database', () => {
    const fresh = openDb(':memory:')
    expect(seedDemoIfNew(fresh, campus.areaId)).toBe(true)
    expect(seedDemoIfNew(fresh, campus.areaId)).toBe(false)
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 4 })
    fresh.close()
  })
})
