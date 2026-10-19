// Thin client for the REACHABLE API (server/). The store decides when to use it.

import type { ClassifierResult } from '../classifier'
import type { Confirmation, Report, Vote } from '../core/types'

/** API origin. Empty means same origin (Vite proxies /api in dev; `npm start` serves both). */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export interface Snapshot {
  now: number
  reports: Report[]
  confirmations: Confirmation[]
}

/** The server answered with an error (it is reachable). */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Any failure that is not an ApiError means the server could not be reached. */
export function isUnreachable(error: unknown): boolean {
  return !(error instanceof ApiError)
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const isForm = body instanceof FormData
  const response = await fetch(BASE + path, {
    method,
    headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // A non-JSON answer (e.g. the dev server's HTML page) means there is no API here.
    throw new Error('No API at this address')
  }
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${response.status})`
    if (response.status >= 500) throw new Error(message)
    throw new ApiError(response.status, message)
  }
  return data as T
}

export function apiHealth(): Promise<{ ok: boolean; classifier: string }> {
  return request('GET', '/api/health', undefined, 2000)
}

export function apiSnapshot(at: number): Promise<Snapshot> {
  return request('GET', `/api/reports?at=${at}`)
}

export interface CreateReportBody {
  pathId: string
  category: string
  severity: string
  description: string
  confidence: number
  aiCategory: string | null
  reporterId: string
  at: number
}

export function apiCreateReport(body: CreateReportBody, photo: Blob | null): Promise<{ report: Report }> {
  const form = new FormData()
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && value !== undefined) form.append(key, String(value))
  }
  if (photo) form.append('photo', photo, 'photo.jpg')
  return request('POST', '/api/reports', form, 20000)
}

export function apiVote(reportId: string, vote: Vote, voterId: string, at: number): Promise<Snapshot> {
  const action = vote === 'cleared' ? 'clear' : 'confirm'
  return request('POST', `/api/reports/${encodeURIComponent(reportId)}/${action}`, { voterId, at })
}

export function apiAdmin(reportId: string, action: 'verify' | 'resolve', at: number): Promise<Snapshot> {
  return request('POST', `/api/reports/${encodeURIComponent(reportId)}/${action}`, { at })
}

export function apiClassify(photo: Blob, fileName: string, context: unknown): Promise<ClassifierResult> {
  const form = new FormData()
  form.append('photo', photo, fileName)
  if (context) form.append('context', JSON.stringify(context))
  return request('POST', '/api/classify', form, 9000)
}

/** Server photo paths need the API origin when the frontend is hosted elsewhere. */
export function photoSrc(url: string | null): string | null {
  return url && url.startsWith('/uploads/') ? BASE + url : url
}
