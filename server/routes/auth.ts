// Login, sign-up and the owner's access requests. Passwords are never returned or logged.

import { Router, type Request } from 'express'
import { randomUUID } from 'node:crypto'
import { hashPassword, MIN_PASSWORD_LENGTH, normaliseEmail, requireOwner, sessionCookie } from '../auth'
import { deleteUser, findUserByEmail, findUserById, insertUser, listUsers, setUserStatus } from '../db'
import { HttpError, type ServerContext } from './context'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL = 254
const MAX_PASSWORD = 200

function credentials(req: Request): { email: string; password: string } {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { email, password } = body
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new HttpError(400, 'Enter an email and a password.')
  }
  if (email.length > MAX_EMAIL || password.length > MAX_PASSWORD) throw new HttpError(400, 'That email or password is too long.')
  return { email, password }
}

export function authRouter(ctx: ServerContext): Router {
  const router = Router()
  const { db, auth } = ctx

  router.get('/auth/config', (_req, res) => {
    res.json({ configured: auth.configured, signupOpen: auth.configured, demo: auth.demo })
  })

  router.get('/auth/me', (req, res) => {
    res.json({ user: auth.sessionFrom(db, req) })
  })

  router.post('/auth/login', (req, res) => {
    if (!auth.configured) throw new HttpError(403, 'Admin login is not set up on this server.')
    const { email, password } = credentials(req)
    const key = `${req.ip}|${normaliseEmail(email)}`
    if (auth.loginBlocked(key)) throw new HttpError(429, 'Too many tries. Wait a few minutes and try again.')
    const person = auth.checkLogin(db, email, password)
    if (!person) {
      auth.recordLoginFail(key)
      throw new HttpError(401, 'Email or password is wrong.')
    }
    auth.clearLoginFails(key)
    const token = auth.sign(person)
    res.setHeader('Set-Cookie', sessionCookie(token, req.secure))
    res.json({ user: auth.sessionFromToken(db, token) })
  })

  router.post('/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', sessionCookie(null, req.secure))
    res.json({ ok: true })
  })

  router.post('/auth/signup', (req, res) => {
    if (!auth.configured) throw new HttpError(403, 'Sign-up is not available because admin login is not set up.')
    if (!auth.signupAllowed(String(req.ip))) throw new HttpError(429, 'Too many sign-ups from here. Try again later.')
    const { email, password } = credentials(req)
    const wanted = normaliseEmail(email)
    if (!EMAIL.test(wanted)) throw new HttpError(400, 'Enter a valid email address.')
    if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`)
    if (auth.isReserved(wanted) || findUserByEmail(db, wanted)) throw new HttpError(409, 'An account with this email already exists.')
    insertUser(db, { id: randomUUID(), email: wanted, passwordHash: hashPassword(password), status: 'pending', createdAt: Date.now() })
    res.status(201).json({ ok: true, status: 'pending' })
  })

  // The owner's access requests.
  const owner = requireOwner(ctx)
  const publicUser = (u: { id: string; email: string; status: string; createdAt: number }) => ({
    id: u.id,
    email: u.email,
    status: u.status,
    createdAt: u.createdAt,
  })

  router.get('/auth/users', owner, (_req, res) => {
    res.json({ users: listUsers(db).map(publicUser) })
  })

  const act = (action: 'approve' | 'reject' | 'remove') =>
    router.post(`/auth/users/:id/${action}`, owner, (req, res) => {
      const user = findUserById(db, String(req.params.id))
      if (!user) throw new HttpError(404, 'No such account.')
      if (action === 'remove') deleteUser(db, user.id)
      else setUserStatus(db, user.id, action === 'approve' ? 'approved' : 'rejected')
      res.json({ users: listUsers(db).map(publicUser) })
    })
  act('approve')
  act('reject')
  act('remove')

  return router
}
