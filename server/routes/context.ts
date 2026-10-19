// Shared server context and small request helpers.

import type { Request } from 'express'
import type { Classifier } from '../../src/classifier'
import type { Campus } from '../../src/core/types'
import type { Auth } from '../auth'
import type { DB } from '../db'

export interface ServerContext {
  db: DB
  campus: Campus
  /** Folder where uploaded photos are written. */
  uploadsDir: string
  /** Classifier used by POST /classify (real model with simulated fallback, or simulated only). */
  classifier: Classifier
  /** Admin login: the owner, the demo account, sign-ups and sessions. */
  auth: Auth
}

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const YEAR = 365 * 24 * 60 * 60 * 1000
const MONTH = 31 * 24 * 60 * 60 * 1000

/**
 * The time to act at. The client may send `at` (its demo clock, e.g. "+6 hours") so freshness
 * matches what the user sees. Anything implausible falls back to the server clock.
 */
export function timeFrom(req: Request): number {
  const serverNow = Date.now()
  const raw = (req.body as Record<string, unknown> | undefined)?.at ?? req.query.at
  const at = Number(raw)
  if (raw === undefined || raw === '' || !Number.isFinite(at)) return serverNow
  if (at < serverNow - YEAR || at > serverNow + MONTH) return serverNow
  return Math.round(at)
}

export function requireString(value: unknown, name: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${name} is required`)
  if (value.length > maxLength) throw new HttpError(400, `${name} is too long`)
  return value.trim()
}
