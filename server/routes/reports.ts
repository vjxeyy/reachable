// Report endpoints: list, create (with photo upload), confirm, clear, admin verify and resolve.

import { Router, type Request } from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { graphFor } from '../../src/core/graph'
import { voteBlockReason, withDerivedStatus } from '../../src/core/trust'
import { CATEGORIES, SEVERITIES, type Category, type Report, type Severity, type Vote } from '../../src/core/types'
import {
  getReport,
  insertConfirmation,
  insertReport,
  listConfirmations,
  listReports,
  updateReportTimes,
  type DB,
} from '../db'
import { requireStaff } from '../auth'
import { HttpError, requireString, timeFrom, type ServerContext } from './context'

const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (PHOTO_TYPES[file.mimetype]) done(null, true)
    else done(new HttpError(400, 'Photo must be a JPEG, PNG, WebP or GIF image'))
  },
})

/** All reports and confirmations for the campus, with status derived at `now`. */
export function snapshot(db: DB, areaId: string, now: number) {
  const confirmations = listConfirmations(db, areaId)
  return { now, reports: withDerivedStatus(listReports(db, areaId), confirmations, now), confirmations }
}

function parseCategory(value: unknown, name: string): Category {
  if (typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)) return value as Category
  throw new HttpError(400, `${name} must be one of ${CATEGORIES.join(', ')}`)
}

function parseSeverity(value: unknown): Severity {
  if (typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value)) return value as Severity
  throw new HttpError(400, `severity must be one of ${SEVERITIES.join(', ')}`)
}

function parseConfidence(value: unknown): number {
  const n = Number(value)
  if (value === undefined || value === '' || !Number.isFinite(n) || n < 0 || n > 1) {
    throw new HttpError(400, 'confidence must be a number from 0 to 1')
  }
  return n
}

function findReport(ctx: ServerContext, req: Request): Report {
  const report = getReport(ctx.db, String(req.params.id))
  if (!report || report.areaId !== ctx.campus.areaId) throw new HttpError(404, 'Report not found')
  return report
}

export function reportsRouter(ctx: ServerContext): Router {
  const router = Router()
  const { db, campus } = ctx

  router.get('/reports', (req, res) => {
    res.json(snapshot(db, campus.areaId, timeFrom(req)))
  })

  router.post('/reports', upload.single('photo'), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const pathId = requireString(body.pathId, 'pathId', 100)
    if (!graphFor(campus).pathById.has(pathId)) throw new HttpError(400, `Unknown path: ${pathId}`)
    const category = parseCategory(body.category, 'category')
    const severity = parseSeverity(body.severity)
    const confidence = parseConfidence(body.confidence)
    const aiCategory = body.aiCategory ? parseCategory(body.aiCategory, 'aiCategory') : null
    const reporterId = requireString(body.reporterId, 'reporterId', 80)
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 280) : ''
    const at = timeFrom(req)
    const id = `r-${randomUUID()}`

    let photoUrl: string | null = null
    if (req.file) {
      const fileName = `${id}.${PHOTO_TYPES[req.file.mimetype]}`
      await writeFile(path.join(ctx.uploadsDir, fileName), req.file.buffer)
      photoUrl = `/uploads/${fileName}`
    }

    const report: Report = {
      id,
      areaId: campus.areaId,
      pathId,
      category,
      severity,
      status: 'unverified',
      confidence,
      aiCategory,
      photoUrl,
      description,
      reporterId,
      createdAt: at,
      lastConfirmedAt: at,
      clearedAt: null,
      adminVerifiedAt: null,
    }
    insertReport(db, report)
    res.status(201).json({ report: withDerivedStatus([report], [], at)[0] })
  })

  const vote = (kind: Vote) =>
    router.post(`/reports/:id/${kind === 'still_there' ? 'confirm' : 'clear'}`, (req, res) => {
      const report = findReport(ctx, req)
      const voterId = requireString((req.body as Record<string, unknown> | undefined)?.voterId, 'voterId', 80)
      const at = timeFrom(req)
      const blocked = voteBlockReason(report, listConfirmations(db, campus.areaId), voterId, kind, at)
      if (blocked) throw new HttpError(409, blocked)
      db.transaction(() => {
        insertConfirmation(db, { reportId: report.id, areaId: report.areaId, voterId, vote: kind, at })
        if (kind === 'cleared') updateReportTimes(db, report.id, { clearedAt: at })
        else updateReportTimes(db, report.id, { lastConfirmedAt: Math.max(report.lastConfirmedAt, at) })
      })()
      res.json(snapshot(db, campus.areaId, at))
    })
  vote('still_there')
  vote('cleared')

  // Admin actions: the owner, approved staff and the demo account (see server/auth.ts).
  const staff = requireStaff(ctx)
  router.post('/reports/:id/verify', staff, (req, res) => {
    const report = findReport(ctx, req)
    const at = timeFrom(req)
    if (report.clearedAt !== null) throw new HttpError(409, 'This report is already cleared.')
    updateReportTimes(db, report.id, { adminVerifiedAt: at, lastConfirmedAt: Math.max(report.lastConfirmedAt, at) })
    res.json(snapshot(db, campus.areaId, at))
  })

  router.post('/reports/:id/resolve', staff, (req, res) => {
    const report = findReport(ctx, req)
    const at = timeFrom(req)
    if (report.clearedAt === null) updateReportTimes(db, report.id, { clearedAt: at })
    res.json(snapshot(db, campus.areaId, at))
  })

  return router
}
