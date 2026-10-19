// Admin login: scrypt password hashing, signed session cookies, roles and rate limits.
// No extra dependencies, only node:crypto. Nothing here ever logs or returns a password.
//
// Roles:
//   owner    the one admin set by ADMIN_EMAIL and ADMIN_PASSWORD (not stored in the database)
//   staff    an approved sign-up, or the public demo account (DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD)
//   pending  a sign-up the owner has not approved yet
// A signed-in person who is none of these is simply a visitor.

import type { NextFunction, Request, Response } from 'express'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { findUserByEmail, type DB } from './db'
import { HttpError } from './routes/context'

export type Role = 'owner' | 'staff' | 'pending'
type Kind = 'owner' | 'demo' | 'user'

export interface SessionUser {
  email: string
  role: Role
  /** True for the public demo account, which is shown on the login page. */
  demo: boolean
}

export interface AuthConfig {
  ownerEmail?: string
  ownerPassword?: string
  demoEmail?: string
  demoPassword?: string
  sessionSecret?: string
}

export const SESSION_COOKIE = 'reachable_session'
const SESSION_MS = 12 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX_FAILS = 5
const SIGNUP_WINDOW_MS = 60 * 60 * 1000
const SIGNUP_MAX = 3
export const MIN_PASSWORD_LENGTH = 10

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  return {
    ownerEmail: env.ADMIN_EMAIL,
    ownerPassword: env.ADMIN_PASSWORD,
    demoEmail: env.DEMO_LOGIN_EMAIL,
    demoPassword: env.DEMO_LOGIN_PASSWORD,
    sessionSecret: env.SESSION_SECRET,
  }
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase()

/** "scrypt$<salt>$<hash>", both base64. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32).toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

// Checked when no account matches, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = hashPassword('not-a-real-password')

interface Credential {
  email: string
  hash: string
}

function credential(email: string | undefined, password: string | undefined): Credential | null {
  if (!email?.trim() || !password) return null
  return { email: normaliseEmail(email), hash: hashPassword(password) }
}

export interface Auth {
  /** True when an owner is set up. Without one, every admin action is locked. */
  readonly configured: boolean
  /** The public demo login, or null. Shown on the login page on purpose. */
  readonly demo: { email: string; password: string } | null
  /** Checks a login. Returns what to put in the cookie, or null (wrong email or password, or a rejected sign-up). */
  checkLogin(db: DB, email: string, password: string): { email: string; kind: Kind } | null
  /** Signs the cookie value for a person who has just logged in. */
  sign(person: { email: string; kind: Kind }): string
  /** Who the cookie belongs to right now, or null. Staff and pending are looked up again, so approvals apply at once. */
  sessionFrom(db: DB, req: Request): SessionUser | null
  /** The same, from a cookie value. */
  sessionFromToken(db: DB, token: string | null): SessionUser | null
  /** True if this email belongs to the owner or the demo account. */
  isReserved(email: string): boolean
  loginBlocked(key: string): boolean
  recordLoginFail(key: string): void
  clearLoginFails(key: string): void
  /** Counts a sign-up attempt and says whether it is allowed. */
  signupAllowed(key: string): boolean
}

export function createAuth(config: AuthConfig = {}, clock: () => number = Date.now): Auth {
  const owner = credential(config.ownerEmail, config.ownerPassword)
  const demo = credential(config.demoEmail, config.demoPassword)
  const secret = config.sessionSecret || randomBytes(32).toString('hex')
  const fails = new Map<string, number[]>()
  const signups = new Map<string, number[]>()

  const recent = (map: Map<string, number[]>, key: string, windowMs: number) => {
    const list = (map.get(key) ?? []).filter((t) => clock() - t < windowMs)
    map.set(key, list)
    return list
  }
  const mac = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

  function parseCookie(req: Request): string | null {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, ...value] = part.trim().split('=')
      if (name === SESSION_COOKIE) return value.join('=') || null
    }
    return null
  }

  return {
    configured: owner !== null,
    demo: demo && config.demoEmail && config.demoPassword ? { email: config.demoEmail.trim(), password: config.demoPassword } : null,

    checkLogin(db, email, password) {
      const wanted = normaliseEmail(email)
      let match: { email: string; kind: Kind; hash: string } | null = null
      if (owner && owner.email === wanted) match = { email: owner.email, kind: 'owner', hash: owner.hash }
      else if (demo && demo.email === wanted) match = { email: demo.email, kind: 'demo', hash: demo.hash }
      else {
        const user = findUserByEmail(db, wanted)
        if (user && user.status !== 'rejected') match = { email: user.email, kind: 'user', hash: user.passwordHash }
      }
      const ok = verifyPassword(password, match?.hash ?? DUMMY_HASH)
      return match && ok ? { email: match.email, kind: match.kind } : null
    },

    sign(person) {
      const payload = Buffer.from(JSON.stringify({ e: person.email, k: person.kind, x: clock() + SESSION_MS })).toString('base64url')
      return `${payload}.${mac(payload)}`
    },

    sessionFrom(db, req) {
      return this.sessionFromToken(db, parseCookie(req))
    },

    sessionFromToken(db, token) {
      if (!token) return null
      const [payload, signature] = token.split('.')
      if (!payload || !signature) return null
      const expected = Buffer.from(mac(payload))
      const given = Buffer.from(signature)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
      let data: { e?: unknown; k?: unknown; x?: unknown }
      try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      } catch {
        return null
      }
      if (typeof data.e !== 'string' || typeof data.x !== 'number' || data.x < clock()) return null
      if (data.k === 'owner') return owner && owner.email === data.e ? { email: data.e, role: 'owner', demo: false } : null
      if (data.k === 'demo') return demo && demo.email === data.e ? { email: data.e, role: 'staff', demo: true } : null
      const user = findUserByEmail(db, data.e)
      if (!user) return null
      if (user.status === 'approved') return { email: user.email, role: 'staff', demo: false }
      if (user.status === 'pending') return { email: user.email, role: 'pending', demo: false }
      return null
    },

    isReserved(email) {
      const wanted = normaliseEmail(email)
      return owner?.email === wanted || demo?.email === wanted
    },

    loginBlocked: (key) => recent(fails, key, LOGIN_WINDOW_MS).length >= LOGIN_MAX_FAILS,
    recordLoginFail: (key) => void recent(fails, key, LOGIN_WINDOW_MS).push(clock()),
    clearLoginFails: (key) => void fails.delete(key),

    signupAllowed(key) {
      const list = recent(signups, key, SIGNUP_WINDOW_MS)
      if (list.length >= SIGNUP_MAX) return false
      list.push(clock())
      return true
    },
  }
}

/** The cookie header value that starts a session (or ends it when `token` is null). */
export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? SESSION_MS / 1000 : 0}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

interface GuardContext {
  db: DB
  auth: Auth
}

function guard(ctx: GuardContext, allowed: (user: SessionUser) => boolean, deniedMessage: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!ctx.auth.configured) throw new HttpError(403, 'Admin login is not set up on this server.')
    const user = ctx.auth.sessionFrom(ctx.db, req)
    if (!user) throw new HttpError(401, 'Sign in as an admin to do this.')
    if (user.role === 'pending') throw new HttpError(403, 'Your account is waiting for approval.')
    if (!allowed(user)) throw new HttpError(403, deniedMessage)
    next()
  }
}

/** Owner, approved staff and the demo account. */
export const requireStaff = (ctx: GuardContext) => guard(ctx, () => true, 'Not allowed.')

/** The owner only. */
export const requireOwner = (ctx: GuardContext) => guard(ctx, (user) => user.role === 'owner', 'Only the owner can do this.')
