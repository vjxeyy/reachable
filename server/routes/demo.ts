// Demo support: example reports on a fresh database, and POST /demo/reset to restore them.

import { Router } from 'express'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import seedData from '../../data/seed-reports.json'
import { buildSeed, type SeedFile } from '../../src/core/seed'
import { deleteAreaReports, getMeta, insertConfirmation, insertReport, setMeta, type DB } from '../db'
import { timeFrom, type ServerContext } from './context'
import { snapshot } from './reports'

const seed = seedData as SeedFile

function insertSeed(db: DB, now: number): void {
  const { reports, confirmations } = buildSeed(seed, now)
  db.transaction(() => {
    for (const report of reports) insertReport(db, report)
    for (const confirmation of confirmations) insertConfirmation(db, confirmation)
  })()
}

/** Loads the example reports once, the first time a database is used for this campus. */
export function seedDemoIfNew(db: DB, areaId: string, now = Date.now()): boolean {
  const key = `seeded:${areaId}`
  if (getMeta(db, key)) return false
  insertSeed(db, now)
  setMeta(db, key, String(now))
  return true
}

/** Deletes every report (and its uploaded photo) and loads the example reports again. */
export async function resetDemo(db: DB, uploadsDir: string, areaId: string, now: number): Promise<void> {
  const photos = deleteAreaReports(db, areaId)
  insertSeed(db, now)
  setMeta(db, `seeded:${areaId}`, String(now))
  await Promise.all(
    photos
      .filter((url) => url.startsWith('/uploads/'))
      .map((url) => rm(path.join(uploadsDir, path.basename(url)), { force: true })),
  )
}

export function demoRouter(ctx: ServerContext): Router {
  const router = Router()
  router.post('/demo/reset', async (req, res) => {
    const now = timeFrom(req)
    await resetDemo(ctx.db, ctx.uploadsDir, ctx.campus.areaId, now)
    res.json(snapshot(ctx.db, ctx.campus.areaId, now))
  })
  return router
}
