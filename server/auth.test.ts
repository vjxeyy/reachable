// Login, sign-up, roles and limits. Made-up credentials only, an in-memory database only, and an
// injected clock, so these tests never read the real environment or touch real data.

import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import campusData from '../data/campus.json'
import { loadCampus } from '../src/core/graph'
import { createAuth, hashPassword, verifyPassword } from './auth'
import { buildServerClassifier } from './classifier-config'
import { openDb, seedCampus, type DB } from './db'
import { createApp } from './index'
import { seedDemoIfNew } from './routes/demo'

const campus = loadCampus(campusData)
const OWNER = { email: 'Owner@Test.Example', password: 'owner-test-password' }
const DEMO = { email: 'judge@test.example', password: 'demo-test-password' }
const HOUR = 60 * 60 * 1000

let now = Date.now()
let db: DB
let server: Server
let base: string
let uploadsDir: string
let reportId: string

function start(config: Parameters<typeof createAuth>[0]) {
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

const fullConfig = { ownerEmail: OWNER.email, ownerPassword: OWNER.password, demoEmail: DEMO.email, demoPassword: DEMO.password, sessionSecret: 'test-secret' }

beforeAll(async () => {
  db = openDb(':memory:')
  seedCampus(db, campus)
  seedDemoIfNew(db, campus.areaId)
  reportId = 'seed-parked-van'
  uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'reachable-auth-uploads-'))
})

afterAll(() => {
  server?.close()
  db?.close()
  rmSync(uploadsDir, { recursive: true, force: true })
})

beforeEach(async () => {
  db.exec('DELETE FROM users')
  now = Date.now()
  await start(fullConfig)
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
const signup = (email: string, password: string, ip?: string) => call('POST', '/api/auth/signup', { email, password }, undefined, ip)

async function owner(): Promise<string> {
  const result = await login(OWNER)
  expect(result.status).toBe(200)
  return result.cookie as string
}

/** Signs a person up, then approves them as the owner. Returns their cookie. */
async function approvedStaff(email: string, password: string): Promise<string> {
  expect((await signup(email, password)).status).toBe(201)
  const ownerCookie = await owner()
  const { data } = await call<{ users: { id: string; email: string }[] }>('GET', '/api/auth/users', undefined, ownerCookie)
  const id = data.users.find((u) => u.email === email.toLowerCase())?.id
  expect((await call('POST', `/api/auth/users/${id}/approve`, {}, ownerCookie)).status).toBe(200)
  const result = await login({ email, password })
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
    expect(result.data).toEqual({ user: { email: OWNER.email.toLowerCase(), role: 'owner', demo: false } })
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

  it('knows who is signed in, and logout ends the session', async () => {
    const cookie = await owner()
    expect((await call<{ user: { role: string } }>('GET', '/api/auth/me', undefined, cookie)).data.user.role).toBe('owner')
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
})

describe('what each role may do', () => {
  const verify = (cookie?: string | null) => call('POST', `/api/reports/${reportId}/verify`, {}, cookie)
  const resolve = (cookie?: string | null) => call('POST', `/api/reports/${reportId}/resolve`, {}, cookie)
  const reset = (cookie?: string | null) => call('POST', '/api/demo/reset', {}, cookie)

  it('keeps verify, resolve and reset closed to people who are not signed in', async () => {
    expect((await verify()).status).toBe(401)
    expect((await resolve()).status).toBe(401)
    expect((await reset()).status).toBe(401)
  })

  it('lets the owner do all three', async () => {
    const cookie = await owner()
    expect((await verify(cookie)).status).toBe(200)
    expect((await resolve(cookie)).status).toBe(200)
    expect((await reset(cookie)).status).toBe(200)
  })

  it('lets the demo account verify and resolve, but not reset or manage people', async () => {
    const result = await login(DEMO)
    expect(result.data).toEqual({ user: { email: DEMO.email, role: 'staff', demo: true } })
    const cookie = result.cookie
    expect((await verify(cookie)).status).toBe(200)
    expect((await resolve(cookie)).status).toBe(200)
    expect((await reset(cookie)).status).toBe(403)
    expect((await call('GET', '/api/auth/users', undefined, cookie)).status).toBe(403)
    await reset(await owner())
  })

  it('keeps a new sign-up out until the owner approves it', async () => {
    expect((await signup('Newcomer@Test.Example', 'a-long-enough-password')).status).toBe(201)
    const pending = await login({ email: 'newcomer@test.example', password: 'a-long-enough-password' })
    expect(pending.data).toEqual({ user: { email: 'newcomer@test.example', role: 'pending', demo: false } })
    expect((await verify(pending.cookie)).status).toBe(403)
    expect((await call('GET', '/api/auth/users', undefined, pending.cookie)).status).toBe(403)
  })

  it('applies approval, rejection and removal at once, with the same cookie', async () => {
    const cookie = await approvedStaff('staff@test.example', 'staff-test-password')
    expect((await verify(cookie)).status).toBe(200)
    expect((await reset(cookie)).status).toBe(403)

    const ownerCookie = await owner()
    const { data } = await call<{ users: { id: string; email: string; status: string }[] }>('GET', '/api/auth/users', undefined, ownerCookie)
    const id = data.users.find((u) => u.email === 'staff@test.example')?.id
    await call('POST', `/api/auth/users/${id}/reject`, {}, ownerCookie)
    expect((await verify(cookie)).status).toBe(401)
    expect((await login({ email: 'staff@test.example', password: 'staff-test-password' })).status).toBe(401)

    await call('POST', `/api/auth/users/${id}/approve`, {}, ownerCookie)
    expect((await verify(cookie)).status).toBe(200)
    await call('POST', `/api/auth/users/${id}/remove`, {}, ownerCookie)
    expect((await verify(cookie)).status).toBe(401)
  })
})

describe('sign-up', () => {
  it('checks the email and the password length', async () => {
    expect((await signup('not-an-email', 'a-long-enough-password')).status).toBe(400)
    expect((await signup('ok@test.example', 'short')).status).toBe(400)
  })

  it('refuses a duplicate email and the owner or demo emails', async () => {
    // Different addresses, so the sign-up limit does not get in the way here.
    expect((await signup('dupe@test.example', 'a-long-enough-password', '192.0.2.1')).status).toBe(201)
    expect((await signup('DUPE@test.example', 'a-long-enough-password', '192.0.2.2')).status).toBe(409)
    expect((await signup(OWNER.email, 'a-long-enough-password', '192.0.2.3')).status).toBe(409)
    expect((await signup(DEMO.email, 'a-long-enough-password', '192.0.2.4')).status).toBe(409)
  })

  it('never returns a password or hash, and stores only a hash', async () => {
    await signup('hash@test.example', 'a-long-enough-password')
    const ownerCookie = await owner()
    const list = await call('GET', '/api/auth/users', undefined, ownerCookie)
    expect(JSON.stringify(list.data)).not.toMatch(/a-long-enough-password|scrypt|password/i)
    const stored = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('hash@test.example') as { password_hash: string }
    expect(stored.password_hash).toMatch(/^scrypt\$/)
    expect(stored.password_hash).not.toContain('a-long-enough-password')
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
    now += 11 * 60 * 1000
    expect((await login(OWNER, '203.0.113.7')).status).toBe(200)
  })

  it('allows 3 sign-ups an hour from one address', async () => {
    for (let i = 0; i < 3; i++) expect((await signup(`n${i}@test.example`, 'a-long-enough-password', '198.51.100.9')).status).toBe(201)
    expect((await signup('n4@test.example', 'a-long-enough-password', '198.51.100.9')).status).toBe(429)
    now += HOUR + 1000
    expect((await signup('n5@test.example', 'a-long-enough-password', '198.51.100.9')).status).toBe(201)
  })
})

describe('when no admin is set up', () => {
  beforeEach(async () => {
    await start({ sessionSecret: 'test-secret' })
  })

  it('locks every admin action and says why', async () => {
    const config = await call<{ configured: boolean; signupOpen: boolean; demo: unknown }>('GET', '/api/auth/config')
    expect(config.data).toEqual({ configured: false, signupOpen: false, demo: null })
    const verify = await call('POST', `/api/reports/${reportId}/verify`, {})
    expect(verify.status).toBe(403)
    expect(JSON.stringify(verify.data)).toMatch(/not set up/)
    expect((await login(OWNER)).status).toBe(403)
    expect((await signup('a@test.example', 'a-long-enough-password')).status).toBe(403)
  })
})

describe('what the login page is told', () => {
  it('shows the demo login when it is set, and never the owner email or password', async () => {
    const config = await call('GET', '/api/auth/config')
    expect(config.data).toEqual({ configured: true, signupOpen: true, demo: { email: DEMO.email, password: DEMO.password } })
    const text = JSON.stringify(config.data).toLowerCase()
    expect(text).not.toContain(OWNER.email.toLowerCase())
    expect(text).not.toContain(OWNER.password)
  })

  it('shows no demo login when none is set', async () => {
    await start({ ownerEmail: OWNER.email, ownerPassword: OWNER.password, sessionSecret: 'test-secret' })
    expect((await call('GET', '/api/auth/config')).data).toEqual({ configured: true, signupOpen: true, demo: null })
  })
})
