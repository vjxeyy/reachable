// App state shared by the pages: campus, reports and confirmations, kept in localStorage so the
// app works with no backend. Routing and trust logic stays in src/core; this file only holds data.

import { useEffect, useState, useSyncExternalStore } from 'react'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { voteBlockReason } from '../core/trust'
import type { Category, Confirmation, ProfileId, Report, Severity, Vote } from '../core/types'

export const campus = loadCampus(campusData)

const DATA_KEY = 'reachable:v1:data'
const CLIENT_KEY = 'reachable:v1:client'
const CLOCK_KEY = 'reachable:v1:clock'

export interface StoreState {
  reports: Report[]
  confirmations: Confirmation[]
  /** Demo clock: how far the app's "now" is ahead of real time. */
  timeOffsetMs: number
  /** The route being looked at. In memory only, so it survives switching to Admin and back. */
  selection: Selection
}

export interface Selection {
  profile: ProfileId
  from: string
  to: string
}

const EMPTY_SELECTION: Selection = { profile: 'wheelchair', from: '', to: '' }

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Short unique id. Works on plain http too, where crypto.randomUUID is unavailable. */
export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function loadClientId(): string {
  const existing = readStorage(CLIENT_KEY)
  if (existing) return existing
  const id = makeId('device')
  writeStorage(CLIENT_KEY, id)
  return id
}

/** Anonymous id for this browser. Lets the trust rules count independent confirmations. */
export const clientId = loadClientId()

function loadOffset(): number {
  const offset = Number(readStorage(CLOCK_KEY))
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function loadData(): Pick<StoreState, 'reports' | 'confirmations'> {
  const raw = readStorage(DATA_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoreState>
      if (Array.isArray(parsed.reports) && Array.isArray(parsed.confirmations)) {
        return { reports: parsed.reports, confirmations: parsed.confirmations }
      }
    } catch {
      // Broken data falls through to an empty store.
    }
  }
  return { reports: [], confirmations: [] }
}

let state: StoreState = { ...loadData(), timeOffsetMs: loadOffset(), selection: EMPTY_SELECTION }
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState(): StoreState {
  return state
}

function setState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch }
  persist()
  for (const listener of listeners) listener()
}

/** Saves to localStorage. If photos fill the quota, drops the oldest photos and tries again. */
function persist(): void {
  writeStorage(CLOCK_KEY, String(state.timeOffsetMs))
  const data = { reports: state.reports, confirmations: state.confirmations }
  if (writeStorage(DATA_KEY, JSON.stringify(data))) return
  const reports = [...data.reports]
  for (let i = 0; i < reports.length; i++) {
    if (reports[i].photoUrl?.startsWith('data:')) {
      reports[i] = { ...reports[i], photoUrl: null }
      if (writeStorage(DATA_KEY, JSON.stringify({ ...data, reports }))) return
    }
  }
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getState)
}

/** Current time used for freshness and report ages, including the demo clock offset. */
export function now(): number {
  return Date.now() + state.timeOffsetMs
}

export function setSelection(patch: Partial<Selection>): void {
  setState({ selection: { ...state.selection, ...patch } })
}

/** Moves the demo clock forward, e.g. +6 hours to show a report going outdated. */
export function advanceClock(ms: number): void {
  setState({ timeOffsetMs: state.timeOffsetMs + ms })
}

export function resetClock(): void {
  setState({ timeOffsetMs: 0 })
}

/** The current time, refreshed every 30 s and on every store change. */
export function useNow(): number {
  const [time, setTime] = useState(now)
  useEffect(() => {
    const timer = setInterval(() => setTime(now()), 30_000)
    const unsubscribe = subscribe(() => setTime(now()))
    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [])
  return time
}

export interface NewReport {
  pathId: string
  category: Category
  severity: Severity
  description: string
  confidence: number
  aiCategory: Category | null
  photoUrl: string | null
}

export function addReport(input: NewReport): Report {
  const at = now()
  const report: Report = {
    id: makeId('r'),
    areaId: campus.areaId,
    pathId: input.pathId,
    category: input.category,
    severity: input.severity,
    status: 'unverified',
    confidence: input.confidence,
    aiCategory: input.aiCategory,
    photoUrl: input.photoUrl,
    description: input.description.trim().slice(0, 280),
    reporterId: clientId,
    createdAt: at,
    lastConfirmedAt: at,
    clearedAt: null,
    adminVerifiedAt: null,
  }
  setState({ reports: [...state.reports, report] })
  return report
}

/** Why this browser cannot cast the vote now, or null. */
export function voteBlocked(report: Report, vote: Vote): string | null {
  return voteBlockReason(report, state.confirmations, clientId, vote, now())
}

/** "Still there" or "Cleared" from this browser. A cleared vote restores routes at once. */
export function castVote(reportId: string, vote: Vote): string | null {
  const report = state.reports.find((r) => r.id === reportId)
  if (!report) return 'Report not found.'
  const blocked = voteBlocked(report, vote)
  if (blocked) return blocked
  const at = now()
  const confirmation: Confirmation = { reportId, areaId: report.areaId, voterId: clientId, vote, at }
  const updated: Report =
    vote === 'cleared'
      ? { ...report, clearedAt: at }
      : { ...report, lastConfirmedAt: Math.max(report.lastConfirmedAt, at) }
  setState({
    confirmations: [...state.confirmations, confirmation],
    reports: state.reports.map((r) => (r.id === reportId ? updated : r)),
  })
  return null
}

function updateReport(reportId: string, change: (report: Report) => Report): void {
  setState({ reports: state.reports.map((r) => (r.id === reportId ? change(r) : r)) })
}

/** Admin verify: the report becomes `verified` at once and counts as freshly seen. */
export function adminVerify(reportId: string): void {
  const at = now()
  updateReport(reportId, (r) => ({ ...r, adminVerifiedAt: at, lastConfirmedAt: Math.max(r.lastConfirmedAt, at) }))
}

/** Admin resolve: the obstacle is fixed, the report is cleared. */
export function adminResolve(reportId: string): void {
  const at = now()
  updateReport(reportId, (r) => (r.clearedAt === null ? { ...r, clearedAt: at } : r))
}
