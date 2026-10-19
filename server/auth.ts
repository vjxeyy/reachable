// Admin login for the Dashboard: one owner, a scrypt-hashed password, a signed session cookie and a
// rate limit. No extra dependencies, only node:crypto. Nothing here ever logs or returns a password.
//
// There is exactly one admin, set by ADMIN_EMAIL and ADMIN_PASSWORD. There is no sign-up, so nobody
// else can get in. Everyone else is a visitor: they can read and report, nothing more.

import type { NextFunction, Request, Response } from 'express'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { HttpError } from './routes/context'

export interface SessionUser {
  email: string
}

export interface AuthConfig {
  ownerEmail?: string
  ownerPassword?: string
  sessionSecret?: string
}

export const SESSION_COOKIE = 'reachable_session'
const SESSION_MS = 12 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX_FAILS = 5

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  return {
    ownerEmail: env.ADMIN_EMAIL,
    ownerPassword: env.ADMIN_PASSWORD,
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

// Checked when the email does not match, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = hashPassword('not-a-real-password')

export interface Auth {
  /** True when an owner is set up. Without one, every admin action is locked. */
  readonly configured: boolean
  /** Checks a login. Returns the owner's email (lower-case) or null for a wrong email or password. */
  checkLogin(email: string, password: string): string | null
  /** Signs the cookie value for the owner who has just logged in. */
  sign(email: string): string
  /** Who the cookie belongs to, or null (no cookie, forged, expired, or not the owner). */
  sessionFrom(req: Request): SessionUser | null
  /** The same, from a cookie value. */
  sessionFromToken(token: string | null): SessionUser | null
  loginBlocked(key: string): boolean
  recordLoginFail(key: string): void
  clearLoginFails(key: string): void
}

export function createAuth(config: AuthConfig = {}, clock: () => number = Date.now): Auth {
  const ownerEmail = config.ownerEmail?.trim() && config.ownerPassword ? normaliseEmail(config.ownerEmail) : null
  const ownerHash = ownerEmail && config.ownerPassword ? hashPassword(config.ownerPassword) : null
  const secret = config.sessionSecret || randomBytes(32).toString('hex')
  const fails = new Map<string, number[]>()

  const recentFails = (key: string) => {
    const list = (fails.get(key) ?? []).filter((t) => clock() - t < LOGIN_WINDOW_MS)
    fails.set(key, list)
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
    configured: ownerEmail !== null,

    checkLogin(email, password) {
      const matches = ownerEmail !== null && normaliseEmail(email) === ownerEmail
      const ok = verifyPassword(password, matches && ownerHash ? ownerHash : DUMMY_HASH)
      return matches && ok ? ownerEmail : null
    },

    sign(email) {
      const payload = Buffer.from(JSON.stringify({ e: email, x: clock() + SESSION_MS })).toString('base64url')
      return `${payload}.${mac(payload)}`
    },

    sessionFrom(req) {
      return this.sessionFromToken(parseCookie(req))
    },

    sessionFromToken(token) {
      if (!token || ownerEmail === null) return null
      const [payload, signature] = token.split('.')
      if (!payload || !signature) return null
      const expected = Buffer.from(mac(payload))
      const given = Buffer.from(signature)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
      let data: { e?: unknown; x?: unknown }
      try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      } catch {
        return null
      }
      if (typeof data.e !== 'string' || typeof data.x !== 'number' || data.x < clock()) return null
      return data.e === ownerEmail ? { email: ownerEmail } : null
    },

    loginBlocked: (key) => recentFails(key).length >= LOGIN_MAX_FAILS,
    recordLoginFail: (key) => void recentFails(key).push(clock()),
    clearLoginFails: (key) => void fails.delete(key),
  }
}

/** The cookie header value that starts a session (or ends it when `token` is null). */
export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? SESSION_MS / 1000 : 0}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** Lets only the signed-in owner through. */
export function requireOwner(ctx: { auth: Auth }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!ctx.auth.configured) throw new HttpError(403, 'Admin login is not set up on this server.')
    if (!ctx.auth.sessionFrom(req)) throw new HttpError(401, 'Sign in as the admin to do this.')
    next()
  }
}
