// Admin login: the owner signs in with an email and a password. Passwords are never returned or logged.

import { Router } from 'express'
import { normaliseEmail, sessionCookie } from '../auth'
import { HttpError, type ServerContext } from './context'

const MAX_EMAIL = 254
const MAX_PASSWORD = 200

export function authRouter(ctx: ServerContext): Router {
  const router = Router()
  const { auth } = ctx

  router.get('/auth/config', (_req, res) => {
    res.json({ configured: auth.configured })
  })

  router.get('/auth/me', (req, res) => {
    res.json({ user: auth.sessionFrom(req) })
  })

  router.post('/auth/login', (req, res) => {
    if (!auth.configured) throw new HttpError(403, 'Admin login is not set up on this server.')
    const { email, password } = (req.body ?? {}) as Record<string, unknown>
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      throw new HttpError(400, 'Enter an email and a password.')
    }
    if (email.length > MAX_EMAIL || password.length > MAX_PASSWORD) throw new HttpError(400, 'That email or password is too long.')
    const key = `${req.ip}|${normaliseEmail(email)}`
    if (auth.loginBlocked(key)) throw new HttpError(429, 'Too many tries. Wait a few minutes and try again.')
    const owner = auth.checkLogin(email, password)
    if (!owner) {
      auth.recordLoginFail(key)
      throw new HttpError(401, 'Email or password is wrong.')
    }
    auth.clearLoginFails(key)
    res.setHeader('Set-Cookie', sessionCookie(auth.sign(owner), req.secure))
    res.json({ user: { email: owner } })
  })

  router.post('/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', sessionCookie(null, req.secure))
    res.json({ ok: true })
  })

  return router
}
