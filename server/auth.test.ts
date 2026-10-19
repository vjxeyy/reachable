// Admin login: the one owner, the cookie, the guards and the limits. Made-up credentials only, an
// in-memory database only, and an injected clock, so these tests never read the real environment or
// touch real data.

import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import campusData from '../data/campus.json'
import { loadCampus } from '../src/core/graph'
import { createAuth, hashPassword, verifyPassword, type AuthConfig } from './auth'
import { buildServerClassifier } from './classifier-config'
import { openDb, seedCampus, type DB } from './db'
import { createApp } from './index'
import { seedDemoIfNew } from './routes/demo'

const campus = loadCampus(campusData)
const OWNER = { email: 'Owner@Test.Example', password: 'owner-test-password' }
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

let now = Date.now()
let db: DB
let server: Server
let base: string
let uploadsDir: string
const reportId = 'seed-parked-van'

function start(config: AuthConfig) {
  const auth = createAuth(config, () => now)
  const app = createApp({ db, campus, uploadsDir, classifier: buildServerClassifier({}, uploadsDir).classifier, auth })
  server?.close()
  server = app.listen(0)
  return new Promise<void>((resolve) => {
    server.once('listening', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      resolve()
    })
  })
}

const ownerConfig: AuthConfig = { ownerEmail: OWNER.email, ownerPassword: OWNER.password, sessionSecret: 'test-secret' }

beforeAll(() => {
  db = openDb(':memory:')
  seedCampus(db, campus)
  seedDemoIfNew(db, campus.areaId)
  uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'reachable-auth-uploads-'))
})

afterAll(() => {
  server?.close()
  db?.close()
  rmSync(uploadsDir, { recursive: true, force: true })
})

beforeEach(async () => {
  now = Date.now()
  await start(ownerConfig)
})

interface Result<T = Record<string, unknown>> {
  status: number
  data: T
  cookie: string | null
  setCookie: string | null
}

async function call<T = Record<string, unknown>>(method: string, url: string, body?: unknown, cookie?: string | null, ip?: string): Promise<Result<T>> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  if (ip) headers['X-Forwarded-For'] = ip
  const response = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const setCookie = response.headers.get('set-cookie')
  return {
    status: response.status,
    data: (await response.json()) as T,
    cookie: setCookie ? setCookie.split(';')[0] : null,
    setCookie,
  }
}

const login = (who: { email: string; password: string }, ip?: string) => call('POST', '/api/auth/login', who, undefined, ip)

async function owner(): Promise<string> {
  const result = await login(OWNER)
  expect(result.status).toBe(200)
  return result.cookie as string
}

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', () => {
    const a = hashPassword('correct horse battery')
    const b = hashPassword('correct horse battery')
    expect(a).not.toBe(b)
    expect(verifyPassword('correct horse battery', a)).toBe(true)
    expect(verifyPassword('wrong', a)).toBe(false)
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(a).not.toContain('correct horse')
  })
})

describe('owner login', () => {
  it('logs in with any letter case in the email, and sets an HttpOnly cookie', async () => {
    const result = await login({ email: OWNER.email.toLowerCase(), password: OWNER.password })
    expect(result.status).toBe(200)
    expect(result.data).toEqual({ user: { email: OWNER.email.toLowerCase() } })
    expect(result.setCookie).toMatch(/HttpOnly/)
    expect(result.setCookie).toMatch(/SameSite=Lax/)
    expect(JSON.stringify(result.data)).not.toContain(OWNER.password)
  })

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({ email: OWNER.email, password: 'nope-nope-nope' })
    const unknownEmail = await login({ email: 'nobody@test.example', password: 'nope-nope-nope' })
    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.data).toEqual(unknownEmail.data)
    expect(wrongPassword.cookie).toBeNull()
  })

  it('asks for both fields and rejects absurd lengths', async () => {
    expect((await call('POST', '/api/auth/login', { email: OWNER.email })).status).toBe(400)
    expect((await call('POST', '/api/auth/login', {})).status).toBe(400)
    expect((await login({ email: OWNER.email, password: 'x'.repeat(500) })).status).toBe(400)
  })

  it('knows who is signed in, and logout ends the session', async () => {
    const cookie = await owner()
    expect((await call<{ user: { email: string } }>('GET', '/api/auth/me', undefined, cookie)).data.user.email).toBe(OWNER.email.toLowerCase())
    const out = await call('POST', '/api/auth/logout', {}, cookie)
    expect(out.setCookie).toMatch(/Max-Age=0/)
    expect((await call('GET', '/api/auth/me')).data).toEqual({ user: null })
  })

  it('rejects a tampered or expired cookie', async () => {
    const cookie = await owner()
    const [name, value] = cookie.split('=')
    expect((await call<{ user: unknown }>('GET', '/api/auth/me', undefined, `${name}=${value.slice(0, -2)}xx`)).data.user).toBeNull()
    expect((await call<{ user: unknown }>('GET', '/api/auth/me', undefined, cookie)).data.user).not.toBeNull()
    now += 13 * HOUR
    expect((await call<{ user: unknown }>('GET', '/api/auth/me', undefined, cookie)).data.user).toBeNull()
  })

  it('does not accept a cookie signed with another secret', async () => {
    const forged = createAuth({ ...ownerConfig, sessionSecret: 'another-secret' }, () => now).sign(OWNER.email.toLowerCase())
    expect((await call<{ user: unknown }>('GET', '/api/auth/me', undefined, `reachable_session=${forged}`)).data.user).toBeNull()
  })
})

describe('what needs the owner', () => {
  const verify = (cookie?: string | null) => call('POST', `/api/reports/${reportId}/verify`, {}, cookie)
  const resolve = (cookie?: string | null) => call('POST', `/api/reports/${reportId}/resolve`, {}, cookie)
  const reset = (cookie?: string | null) => call('POST', '/api/demo/reset', {}, cookie)

  it('keeps verify, resolve and reset closed to anyone who is not signed in', async () => {
    expect((await verify()).status).toBe(401)
    expect((await resolve()).status).toBe(401)
    expect((await reset()).status).toBe(401)
  })

  it('lets the signed-in owner do all three, and not after logging out', async () => {
    const cookie = await owner()
    expect((await verify(cookie)).status).toBe(200)
    expect((await resolve(cookie)).status).toBe(200)
    expect((await reset(cookie)).status).toBe(200)
    await call('POST', '/api/auth/logout', {}, cookie)
    // The cookie itself is still signed, but logging out clears it in the browser, which is what matters.
    expect((await verify(null)).status).toBe(401)
  })

  it('still lets anyone read and report, signed in or not', async () => {
    expect((await call('GET', '/api/reports')).status).toBe(200)
    expect((await call('GET', '/api/route?from=library&to=hostel&profile=wheelchair')).status).toBe(200)
  })

  it('has no sign-up and no way to create other admins', async () => {
    expect((await call('POST', '/api/auth/signup', { email: 'a@test.example', password: 'a-long-enough-password' })).status).toBe(404)
    expect((await call('GET', '/api/auth/users')).status).toBe(404)
  })
})

describe('clearing reports', () => {
  const clear = (id: string, cookie?: string | null) => call('POST', `/api/reports/${id}/clear`, { voterId: 'a-passer-by' }, cookie)

  it('lets anyone clear an unverified report with one press', async () => {
    await call('POST', '/api/demo/reset', {}, await owner())
    expect((await clear('seed-kerb')).status).toBe(200)
  })

  it('keeps verified blocks for the admin, whether an admin or two people verified them', async () => {
    const cookie = await owner()
    await call('POST', '/api/demo/reset', {}, cookie)
    // seed-flooding was verified by an admin, seed-raised-slabs by two confirmations.
    const byAdmin = await clear('seed-flooding')
    expect(byAdmin.status).toBe(403)
    expect(JSON.stringify(byAdmin.data)).toMatch(/Only the admin/)
    expect((await clear('seed-raised-slabs')).status).toBe(403)
    // Still there is open to everyone.
    expect((await call('POST', '/api/reports/seed-flooding/confirm', { voterId: 'a-passer-by' })).status).toBe(200)
    // The signed-in admin can clear it.
    expect((await clear('seed-flooding', cookie)).status).toBe(200)
    expect((await clear('seed-raised-slabs', cookie)).status).toBe(200)
  })
})

describe('limits', () => {
  it('blocks a sixth failed login from the same place, then lets it through later', async () => {
    for (let i = 0; i < 5; i++) expect((await login({ email: OWNER.email, password: 'wrong-wrong-wrong' }, '203.0.113.7')).status).toBe(401)
    expect((await login({ email: OWNER.email, password: 'wrong-wrong-wrong' }, '203.0.113.7')).status).toBe(429)
    // Even the right password waits, so guessing cannot continue.
    expect((await login(OWNER, '203.0.113.7')).status).toBe(429)
    // Another address is not affected.
    expect((await login(OWNER, '203.0.113.8')).status).toBe(200)
    now += 11 * MINUTE
    expect((await login(OWNER, '203.0.113.7')).status).toBe(200)
  })
})

describe('when no admin is set up', () => {
  beforeEach(async () => {
    await start({ sessionSecret: 'test-secret' })
  })

  it('locks every admin action and says why', async () => {
    expect((await call('GET', '/api/auth/config')).data).toEqual({ configured: false })
    const verify = await call('POST', `/api/reports/${reportId}/verify`, {})
    expect(verify.status).toBe(403)
    expect(JSON.stringify(verify.data)).toMatch(/not set up/)
    expect((await login(OWNER)).status).toBe(403)
  })

  it('does not set up an owner from an email with no password', async () => {
    await start({ ownerEmail: OWNER.email, sessionSecret: 'test-secret' })
    expect((await call('GET', '/api/auth/config')).data).toEqual({ configured: false })
  })
})

describe('what the login page is told', () => {
  it('says login is set up, and never the owner email or password', async () => {
    const config = await call('GET', '/api/auth/config')
    expect(config.data).toEqual({ configured: true })
    const text = JSON.stringify(config.data).toLowerCase()
    expect(text).not.toContain(OWNER.email.toLowerCase())
    expect(text).not.toContain(OWNER.password)
  })
})
