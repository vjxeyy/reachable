// App state shared by the pages. Reports come from the API server when it is reachable and from
// localStorage when it is not, so the app always works. Routing and trust logic stays in src/core.

import { useEffect, useState, useSyncExternalStore } from 'react'
import campusData from '../../data/campus.json'
import seedData from '../../data/seed-reports.json'
import { setRemoteClassifier, type Classifier } from '../classifier'
import { loadCampus } from '../core/graph'
import { buildSeed, type SeedFile } from '../core/seed'
import { voteBlockReason } from '../core/trust'
import type { Category, Confirmation, ProfileId, Report, Severity, Vote } from '../core/types'
import {
  apiAdmin,
  apiAuthConfig,
  apiClassify,
  apiCreateReport,
  apiHealth,
  apiLogin,
  apiLogout,
  apiMe,
  apiResetDemo,
  apiSnapshot,
  apiVote,
  isUnreachable,
  type AuthConfig,
  type AuthUser,
  type Snapshot,
} from './api'

export const campus = loadCampus(campusData)

const DATA_KEY = 'reachable:v1:data'
const CLIENT_KEY = 'reachable:v1:client'
const CLOCK_KEY = 'reachable:v1:clock'
const SEEDED_KEY = 'reachable:v1:seeded'

/** Example reports for a fresh start, timed relative to `now`. */
function demoSeed(now: number): Data {
  return buildSeed(seedData as SeedFile, now)
}

/** Where reports come from: the shared server, or this browser only. */
export type Source = 'connecting' | 'api' | 'local'

interface Data {
  reports: Report[]
  confirmations: Confirmation[]
}

export interface Selection {
  /** One or more profiles, never empty. Several combine into the strictest of them. */
  profiles: ProfileId[]
  from: string
  to: string
}

/** Admin login, known only while the shared server is connected. */
export interface AuthState {
  /** False until the server has answered. */
  ready: boolean
  config: AuthConfig | null
  user: AuthUser | null
}

const NO_AUTH: AuthState = { ready: false, config: null, user: null }

export interface StoreState extends Data {
  source: Source
  auth: AuthState
  /** Demo clock: how far the app's "now" is ahead of real time. */
  timeOffsetMs: number
  /** The route being looked at. In memory only, so it survives switching to Admin and back. */
  selection: Selection
  toast: { id: number; text: string } | null
}

const EMPTY_SELECTION: Selection = { profiles: ['wheelchair'], from: '', to: '' }

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
  // First visit: start with the example reports so the map is not empty.
  if (!readStorage(SEEDED_KEY)) {
    const seeded = demoSeed(Date.now())
    writeStorage(SEEDED_KEY, '1')
    writeStorage(DATA_KEY, JSON.stringify(seeded))
    return seeded
  }
  return { reports: [], confirmations: [] }
}

/** The browser-only copy, used whenever the server is not reachable. */
let localData: Data = loadLocal()

let state: StoreState = {
  ...localData,
  source: 'connecting',
  auth: NO_AUTH,
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

/** Photos go to the server's classifier (real model when it has a key) while the server is reachable. */
const serverClassifier: Classifier = {
  name: 'server',
  classify: (input) =>
    apiClassify(new Blob([input.image as Uint8Array<ArrayBuffer>], { type: input.mimeType }), input.fileName ?? 'photo.jpg', input.context),
}

function setState(patch: Partial<StoreState>): void {
  const sourceChanged = patch.source !== undefined && patch.source !== state.source
  if (sourceChanged) setRemoteClassifier(patch.source === 'api' ? serverClassifier : null)
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
  if (sourceChanged) {
    if (patch.source === 'api') void loadAuth()
    else setState({ auth: NO_AUTH })
  }
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

// ---------- Admin login ----------

/** Asks the server who is signed in and how login is set up. */
export async function loadAuth(): Promise<void> {
  try {
    const [config, me] = await Promise.all([apiAuthConfig(), apiMe()])
    if (state.source === 'api') setState({ auth: { ready: true, config, user: me.user } })
  } catch {
    // An older server without login: leave the Dashboard as it was.
    if (state.source === 'api') setState({ auth: { ready: true, config: { configured: false }, user: null } })
  }
}

/** Refreshes who is signed in (the session may have ended). */
async function refreshMe(): Promise<void> {
  if (state.source !== 'api' || !state.auth.ready) return
  try {
    const me = await apiMe()
    if (state.source === 'api' && JSON.stringify(me.user) !== JSON.stringify(state.auth.user)) {
      setState({ auth: { ...state.auth, user: me.user } })
    }
  } catch {
    // The report sync handles an unreachable server.
  }
}

/** Signs in. Returns an error message, or null on success. */
export async function login(email: string, password: string): Promise<string | null> {
  try {
    const { user } = await apiLogin(email, password)
    setState({ auth: { ...state.auth, ready: true, user } })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not sign in.'
  }
}

export async function logout(): Promise<void> {
  try {
    await apiLogout()
  } catch {
    // Signed out here either way.
  }
  setState({ auth: { ...state.auth, user: null } })
}

/** Turns a refusal into a message and re-checks who is signed in (the session may have ended). */
function afterRefusal(message: string | null): string | null {
  if (message) void refreshMe()
  return message
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
    if (ticks % 6 === 0) void refreshMe()
  }, 5000)
  const onFocus = () => {
    void sync()
    void refreshMe()
  }
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
  // With no server the reports are this browser's own, so there is nobody to protect them from.
  const isAdmin = state.source !== 'api' || state.auth.user !== null
  return voteBlockReason(report, state.confirmations, clientId, vote, now(), isAdmin)
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
  return write((data) => withAdmin(data, reportId, 'verify', at), () => apiAdmin(reportId, 'verify', at)).then(afterRefusal)
}

/** Admin resolve: the obstacle is fixed, the report is cleared. */
export function adminResolve(reportId: string): Promise<string | null> {
  const at = now()
  return write((data) => withAdmin(data, reportId, 'resolve', at), () => apiAdmin(reportId, 'resolve', at)).then(afterRefusal)
}

/**
 * Reset demo: example reports back, demo clock back to now, route picker cleared. Uses the server
 * when it is reachable (so every browser sees the reset), otherwise this browser's copy.
 */
export async function resetDemo(): Promise<void> {
  // On the shared server only the signed-in admin may wipe every report. Say so before changing anything here.
  if (state.source === 'api' && !state.auth.user) {
    notify('Sign in as the admin to reset the demo.')
    return
  }
  writeVersion++
  setOffset(0)
  setState({ selection: EMPTY_SELECTION })
  const at = Date.now()
  try {
    if (state.source === 'api') {
      try {
        show(await apiResetDemo(at))
        notify('Demo reset. Example reports restored for everyone.')
        return
      } catch (error) {
        if (!isUnreachable(error)) {
          notify(error instanceof Error ? error.message : 'The server could not reset the demo.')
          return
        }
        fallBackToLocal(demoSeed(at), 'Server unreachable. Demo reset in this browser only.')
        return
      }
    }
    writeStorage(SEEDED_KEY, '1')
    saveLocal(demoSeed(at))
    notify('Demo reset. Example reports restored.')
  } finally {
    writeVersion++
  }
}
