// SQLite storage for campus data, reports and confirmations (better-sqlite3).
// Status is never stored: it is derived from these rows by src/core/trust.ts.

import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Campus, Category, Confirmation, Report, Severity, Vote } from '../src/core/types'

export type DB = Database.Database

const here = path.dirname(fileURLToPath(import.meta.url))

/** The real database file. Tests must never open it. */
export const DEFAULT_DB_PATH = path.join(here, 'data', 'reachable.db')

/**
 * Opens (and migrates) a database. Under Vitest only an in-memory database is allowed, so a test
 * can never touch real data.
 */
export function openDb(file: string): DB {
  if (process.env.VITEST && file !== ':memory:') {
    throw new Error(`Refusing to open ${file} while testing. Tests must use ':memory:'.`)
  }
  const db = new Database(file)
  if (file !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT NOT NULL, area_id TEXT NOT NULL, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      PRIMARY KEY (area_id, id)
    );
    CREATE TABLE IF NOT EXISTS paths (
      id TEXT NOT NULL, area_id TEXT NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL,
      length_m REAL NOT NULL, step_free INTEGER NOT NULL, width_m REAL NOT NULL, slope_pct REAL NOT NULL,
      PRIMARY KEY (area_id, id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, area_id TEXT NOT NULL, path_id TEXT NOT NULL,
      category TEXT NOT NULL, severity TEXT NOT NULL, confidence REAL NOT NULL, ai_category TEXT,
      photo_url TEXT, description TEXT NOT NULL DEFAULT '', reporter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_confirmed_at INTEGER NOT NULL,
      cleared_at INTEGER, admin_verified_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS reports_area ON reports (area_id);
    CREATE TABLE IF NOT EXISTS confirmations (
      report_id TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
      area_id TEXT NOT NULL, voter_id TEXT NOT NULL, vote TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS confirmations_report ON confirmations (report_id);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `)
}

/** Copies the campus file into the nodes and paths tables (idempotent). */
export function seedCampus(db: DB, campus: Campus): void {
  const node = db.prepare('INSERT OR REPLACE INTO nodes (id, area_id, name, x, y) VALUES (?, ?, ?, ?, ?)')
  const path = db.prepare(
    `INSERT OR REPLACE INTO paths (id, area_id, from_node, to_node, length_m, step_free, width_m, slope_pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  db.transaction(() => {
    for (const n of campus.nodes) node.run(n.id, n.areaId, n.name, n.x, n.y)
    for (const p of campus.paths) {
      path.run(p.id, p.areaId, p.from, p.to, p.lengthM, p.stepFree ? 1 : 0, p.widthM, p.slopePct)
    }
  })()
}

interface ReportRow {
  id: string
  area_id: string
  path_id: string
  category: string
  severity: string
  confidence: number
  ai_category: string | null
  photo_url: string | null
  description: string
  reporter_id: string
  created_at: number
  last_confirmed_at: number
  cleared_at: number | null
  admin_verified_at: number | null
}

interface ConfirmationRow {
  report_id: string
  area_id: string
  voter_id: string
  vote: string
  at: number
}

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    areaId: row.area_id,
    pathId: row.path_id,
    category: row.category as Category,
    severity: row.severity as Severity,
    // Placeholder; callers derive the real status with deriveStatus().
    status: 'unverified',
    confidence: row.confidence,
    aiCategory: row.ai_category as Category | null,
    photoUrl: row.photo_url,
    description: row.description,
    reporterId: row.reporter_id,
    createdAt: row.created_at,
    lastConfirmedAt: row.last_confirmed_at,
    clearedAt: row.cleared_at,
    adminVerifiedAt: row.admin_verified_at,
  }
}

function toConfirmation(row: ConfirmationRow): Confirmation {
  return { reportId: row.report_id, areaId: row.area_id, voterId: row.voter_id, vote: row.vote as Vote, at: row.at }
}

export function listReports(db: DB, areaId: string): Report[] {
  const rows = db.prepare('SELECT * FROM reports WHERE area_id = ? ORDER BY created_at, id').all(areaId) as ReportRow[]
  return rows.map(toReport)
}

export function getReport(db: DB, id: string): Report | null {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow | undefined
  return row ? toReport(row) : null
}

export function listConfirmations(db: DB, areaId: string): Confirmation[] {
  const rows = db
    .prepare('SELECT * FROM confirmations WHERE area_id = ? ORDER BY at, rowid')
    .all(areaId) as ConfirmationRow[]
  return rows.map(toConfirmation)
}

export function insertReport(db: DB, r: Report): void {
  db.prepare(
    `INSERT INTO reports (id, area_id, path_id, category, severity, confidence, ai_category, photo_url, description,
       reporter_id, created_at, last_confirmed_at, cleared_at, admin_verified_at)
     VALUES (@id, @areaId, @pathId, @category, @severity, @confidence, @aiCategory, @photoUrl, @description,
       @reporterId, @createdAt, @lastConfirmedAt, @clearedAt, @adminVerifiedAt)`,
  ).run({
    id: r.id,
    areaId: r.areaId,
    pathId: r.pathId,
    category: r.category,
    severity: r.severity,
    confidence: r.confidence,
    aiCategory: r.aiCategory,
    photoUrl: r.photoUrl,
    description: r.description,
    reporterId: r.reporterId,
    createdAt: r.createdAt,
    lastConfirmedAt: r.lastConfirmedAt,
    clearedAt: r.clearedAt,
    adminVerifiedAt: r.adminVerifiedAt,
  })
}

export function insertConfirmation(db: DB, c: Confirmation): void {
  db.prepare('INSERT INTO confirmations (report_id, area_id, voter_id, vote, at) VALUES (?, ?, ?, ?, ?)').run(
    c.reportId,
    c.areaId,
    c.voterId,
    c.vote,
    c.at,
  )
}

/** Updates the mutable timestamps of a report. */
export function updateReportTimes(
  db: DB,
  id: string,
  times: Partial<Pick<Report, 'lastConfirmedAt' | 'clearedAt' | 'adminVerifiedAt'>>,
): void {
  const current = getReport(db, id)
  if (!current) return
  const next = { ...current, ...times }
  db.prepare('UPDATE reports SET last_confirmed_at = ?, cleared_at = ?, admin_verified_at = ? WHERE id = ?').run(
    next.lastConfirmedAt,
    next.clearedAt,
    next.adminVerifiedAt,
    id,
  )
}

/** Deletes every report and confirmation for an area (used by "Reset demo"). Returns the photo URLs removed. */
export function deleteAreaReports(db: DB, areaId: string): string[] {
  const photos = db
    .prepare('SELECT photo_url FROM reports WHERE area_id = ? AND photo_url IS NOT NULL')
    .all(areaId) as { photo_url: string }[]
  db.transaction(() => {
    db.prepare('DELETE FROM confirmations WHERE area_id = ?').run(areaId)
    db.prepare('DELETE FROM reports WHERE area_id = ?').run(areaId)
  })()
  return photos.map((p) => p.photo_url)
}

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
}

// ---------- Sign-ups (the owner and the demo account live in env vars, not here) ----------

export type UserStatus = 'pending' | 'approved' | 'rejected'

export interface UserRow {
  id: string
  /** Always lower-case. */
  email: string
  passwordHash: string
  status: UserStatus
  createdAt: number
}

interface RawUser {
  id: string
  email: string
  password_hash: string
  status: UserStatus
  created_at: number
}

const toUser = (row: RawUser): UserRow => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  status: row.status,
  createdAt: row.created_at,
})

export function insertUser(db: DB, user: UserRow): void {
  db.prepare('INSERT INTO users (id, email, password_hash, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
    user.id,
    user.email,
    user.passwordHash,
    user.status,
    user.createdAt,
  )
}

export function findUserByEmail(db: DB, email: string): UserRow | null {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as RawUser | undefined
  return row ? toUser(row) : null
}

export function findUserById(db: DB, id: string): UserRow | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawUser | undefined
  return row ? toUser(row) : null
}

export function listUsers(db: DB): UserRow[] {
  return (db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as RawUser[]).map(toUser)
}

export function setUserStatus(db: DB, id: string, status: UserStatus): void {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id)
}

export function deleteUser(db: DB, id: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
}
