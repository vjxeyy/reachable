// App state shared by the pages. Reports come from the API server when it is reachable and from
// localStorage when it is not, so the app always works. Routing and trust logic stays in src/core.

import { useEffect, useState, useSyncExternalStore } from 'react'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { voteBlockReason } from '../core/trust'
import type { Category, Confirmation, ProfileId, Report, Severity, Vote } from '../core/types'
import { apiAdmin, apiCreateReport, apiHealth, apiSnapshot, apiVote, isUnreachable, type Snapshot } from './api'

export const campus = loadCampus(campusData)

const DATA_KEY = 'reachable:v1:data'
const CLIENT_KEY = 'reachable:v1:client'
const CLOCK_KEY = 'reachable:v1:clock'

/** Where reports come from: the shared server, or this browser only. */
export type Source = 'connecting' | 'api' | 'local'

interface Data {
  reports: Report[]
  confirmations: Confirmation[]
}

export interface Selection {
  profile: ProfileId
  from: string
  to: string
}

export interface StoreState extends Data {
  source: Source
  /** Demo clock: how far the app's "now" is ahead of real time. */
  timeOffsetMs: number
  /** The route being looked at. In memory only, so it survives switching to Admin and back. */
  selection: Selection
  toast: { id: number; text: string } | null
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

function loadLocal(): Data {
  const raw = readStorage(DATA_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Data>
      if (Array.isArray(parsed.reports) && Array.isArray(parsed.confirmations)) {
        return { reports: parsed.reports, confirmations: parsed.confirmations }
      }
    } catch {
      // Broken data falls through to an empty store.
    }
  }
  return { reports: [], confirmations: [] }
}

/** The browser-only copy, used whenever the server is not reachable. */
let localData: Data = loadLocal()

let state: StoreState = {
  ...localData,
  source: 'connecting',
  timeOffsetMs: loadOffset(),
  selection: EMPTY_SELECTION,
  toast: null,
}
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
  for (const listener of listeners) listener()
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getState)
}

let toastId = 0
/** Shows a short message at the bottom of the screen. */
export function notify(text: string): void {
  setState({ toast: { id: ++toastId, text } })
}

export function dismissToast(id: number): void {
  if (state.toast?.id === id) setState({ toast: null })
}

/** Saves the browser copy. If photos fill the quota, drops the oldest photos and tries again. */
function persistLocal(): void {
  if (writeStorage(DATA_KEY, JSON.stringify(localData))) return
  const reports = [...localData.reports]
  for (let i = 0; i < reports.length; i++) {
    if (reports[i].photoUrl?.startsWith('data:')) {
      reports[i] = { ...reports[i], photoUrl: null }
      if (writeStorage(DATA_KEY, JSON.stringify({ ...localData, reports }))) return
    }
  }
}

function currentData(): Data {
  return { reports: state.reports, confirmations: state.confirmations }
}

function show(data: Data): void {
  setState({ reports: data.reports, confirmations: data.confirmations })
}

function saveLocal(data: Data): void {
  localData = data
  persistLocal()
  if (state.source !== 'api') show(data)
}

/** Server lost: keep showing what we have, from now on stored in this browser. */
function fallBackToLocal(data: Data, message: string): void {
  localData = data
  persistLocal()
  setState({ source: 'local', ...data })
  notify(message)
}

function switchToServer(snapshot: Snapshot): void {
  const wasLocal = state.source === 'local'
  setState({ source: 'api', reports: snapshot.reports, confirmations: snapshot.confirmations })
  if (wasLocal) notify('Connected to the shared server. Reports are now shared.')
}

// ---------- Time ----------

/** Current time used for freshness and report ages, including the demo clock offset. */
export function now(): number {
  return Date.now() + state.timeOffsetMs
}

function setOffset(timeOffsetMs: number): void {
  writeStorage(CLOCK_KEY, String(timeOffsetMs))
  setState({ timeOffsetMs })
}

/** Moves the demo clock forward, e.g. +6 hours to show a report going outdated. */
export function advanceClock(ms: number): void {
  setOffset(state.timeOffsetMs + ms)
}

export function resetClock(): void {
  setOffset(0)
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

export function setSelection(patch: Partial<Selection>): void {
  setState({ selection: { ...state.selection, ...patch } })
}

// ---------- Sync with the server ----------

/** Bumped by every write, so a slow poll never overwrites a newer change. */
let writeVersion = 0
let ticks = 0

async function sync(): Promise<void> {
  const version = writeVersion
  if (state.source === 'api') {
    try {
      const snapshot = await apiSnapshot(now())
      if (state.source === 'api' && version === writeVersion) show(snapshot)
    } catch (error) {
      if (isUnreachable(error) && state.source === 'api') {
        fallBackToLocal(currentData(), 'Server unreachable. Working offline in this browser.')
      }
    }
    return
  }
  try {
    await apiHealth()
    const snapshot = await apiSnapshot(now())
    if (version === writeVersion) switchToServer(snapshot)
  } catch {
    if (state.source === 'connecting') setState({ source: 'local' })
  }
}

/** Starts polling: every 5 s while on the server (to see other people's reports), every 15 s while offline. */
export function startSync(): () => void {
  void sync()
  const timer = setInterval(() => {
    ticks++
    if (state.source === 'api' || ticks % 3 === 0) void sync()
  }, 5000)
  const onFocus = () => void sync()
  window.addEventListener('focus', onFocus)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', onFocus)
  }
}

// ---------- Pure data updates (used offline and for instant feedback online) ----------

function withVote(data: Data, report: Report, vote: Vote, at: number): Data {
  const confirmation: Confirmation = { reportId: report.id, areaId: report.areaId, voterId: clientId, vote, at }
  const updated: Report =
    vote === 'cleared' ? { ...report, clearedAt: at } : { ...report, lastConfirmedAt: Math.max(report.lastConfirmedAt, at) }
  return {
    confirmations: [...data.confirmations, confirmation],
    reports: data.reports.map((r) => (r.id === report.id ? updated : r)),
  }
}

function withAdmin(data: Data, reportId: string, action: 'verify' | 'resolve', at: number): Data {
  return {
    ...data,
    reports: data.reports.map((r) => {
      if (r.id !== reportId) return r
      if (action === 'resolve') return r.clearedAt === null ? { ...r, clearedAt: at } : r
      return { ...r, adminVerifiedAt: at, lastConfirmedAt: Math.max(r.lastConfirmedAt, at) }
    }),
  }
}

/**
 * Applies a change instantly, then confirms it with the server. If the server refuses, the change
 * is undone and the reason returned. If the server is gone, the change is kept offline.
 */
async function write(change: (data: Data) => Data, send: () => Promise<Snapshot>): Promise<string | null> {
  if (state.source !== 'api') {
    saveLocal(change(localData))
    return null
  }
  writeVersion++
  const before = currentData()
  const after = change(before)
  show(after)
  try {
    show(await send())
    return null
  } catch (error) {
    if (isUnreachable(error)) {
      fallBackToLocal(after, 'Server unreachable. Saved in this browser only.')
      return null
    }
    show(before)
    return error instanceof Error ? error.message : 'The server refused this change.'
  } finally {
    writeVersion++
  }
}

// ---------- Actions ----------

export interface NewReport {
  pathId: string
  category: Category
  severity: Severity
  description: string
  confidence: number
  aiCategory: Category | null
  /** A data: URL of the shrunk JPEG, or null. */
  photoUrl: string | null
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

/** Saves a new report. Returns an error message if the server rejected it. */
export async function addReport(input: NewReport): Promise<{ report: Report } | { error: string }> {
  const at = now()
  const draft: Report = {
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
  const add = (data: Data): Data => ({ ...data, reports: [...data.reports, draft] })

  if (state.source !== 'api') {
    saveLocal(add(localData))
    return { report: draft }
  }
  writeVersion++
  try {
    const photo = input.photoUrl?.startsWith('data:') ? await dataUrlToBlob(input.photoUrl) : null
    const { report } = await apiCreateReport(
      {
        pathId: draft.pathId,
        category: draft.category,
        severity: draft.severity,
        description: draft.description,
        confidence: draft.confidence,
        aiCategory: draft.aiCategory,
        reporterId: clientId,
        at,
      },
      photo,
    )
    show({ ...currentData(), reports: [...state.reports, report] })
    return { report }
  } catch (error) {
    if (isUnreachable(error)) {
      fallBackToLocal(add(currentData()), 'Server unreachable. Report saved in this browser only.')
      return { report: draft }
    }
    return { error: error instanceof Error ? error.message : 'The server rejected this report.' }
  } finally {
    writeVersion++
  }
}

/** Why this browser cannot cast the vote now, or null. */
export function voteBlocked(report: Report, vote: Vote): string | null {
  return voteBlockReason(report, state.confirmations, clientId, vote, now())
}

/** "Still there" or "Cleared" from this browser. A cleared vote restores routes at once. */
export async function castVote(reportId: string, vote: Vote): Promise<string | null> {
  const report = state.reports.find((r) => r.id === reportId)
  if (!report) return 'Report not found.'
  const blocked = voteBlocked(report, vote)
  if (blocked) return blocked
  const at = now()
  return write(
    (data) => withVote(data, data.reports.find((r) => r.id === reportId) ?? report, vote, at),
    () => apiVote(reportId, vote, clientId, at),
  )
}

/** Admin verify: the report becomes `verified` at once and counts as freshly seen. */
export function adminVerify(reportId: string): Promise<string | null> {
  const at = now()
  return write((data) => withAdmin(data, reportId, 'verify', at), () => apiAdmin(reportId, 'verify', at))
}

/** Admin resolve: the obstacle is fixed, the report is cleared. */
export function adminResolve(reportId: string): Promise<string | null> {
  const at = now()
  return write((data) => withAdmin(data, reportId, 'resolve', at), () => apiAdmin(reportId, 'resolve', at))
}
