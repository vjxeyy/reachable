// App state shared by the pages. Grows phase by phase: reports (Phase 3), time control (Phase 4),
// API sync (Phase 6). Routing and trust logic stays in src/core; this file only holds data.

import { useEffect, useState, useSyncExternalStore } from 'react'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import type { Confirmation, Report } from '../core/types'

export const campus = loadCampus(campusData)

export interface StoreState {
  reports: Report[]
  confirmations: Confirmation[]
}

let state: StoreState = { reports: [], confirmations: [] }
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState(): StoreState {
  return state
}

export function setState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getState)
}

/** The current time, refreshed every 30 s so report ages and freshness stay current. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
