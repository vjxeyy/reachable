// Demo support: POST /demo/reset wipes every report. There are no example reports; the app starts empty.

import { Router } from 'express'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { deleteAreaReports, type DB } from '../db'
import { requireOwner } from '../auth'
import { timeFrom, type ServerContext } from './context'
import { snapshot } from './reports'

/** Deletes every report (and its uploaded photo) for this campus. */
export async function resetDemo(db: DB, uploadsDir: string, areaId: string): Promise<void> {
  const photos = deleteAreaReports(db, areaId)
  await Promise.all(
    photos
      .filter((url) => url.startsWith('/uploads/'))
      .map((url) => rm(path.join(uploadsDir, path.basename(url)), { force: true })),
  )
}

export function demoRouter(ctx: ServerContext): Router {
  const router = Router()
  // Wiping every report is for the owner only.
  router.post('/demo/reset', requireOwner(ctx), async (req, res) => {
    const now = timeFrom(req)
    await resetDemo(ctx.db, ctx.uploadsDir, ctx.campus.areaId)
    res.json(snapshot(ctx.db, ctx.campus.areaId, now))
  })
  return router
}
