// App state shared by the pages: campus, reports and confirmations, kept in localStorage so the
// app works with no backend. Routing and trust logic stays in src/core; this file only holds data.

import { useEffect, useState, useSyncExternalStore } from 'react'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import type { Category, Confirmation, Report, Severity } from '../core/types'

export const campus = loadCampus(campusData)

const DATA_KEY = 'reachable:v1:data'
const CLIENT_KEY = 'reachable:v1:client'

export interface StoreState {
  reports: Report[]
  confirmations: Confirmation[]
}

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

function loadData(): StoreState {
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

let state: StoreState = loadData()
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

/** Current time used for freshness and report ages. */
export function now(): number {
  return Date.now()
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
