// GET /route: the same verification-aware routing the browser runs, from src/core.

import { Router } from 'express'
import { graphFor } from '../../src/core/graph'
import { findRoute } from '../../src/core/route'
import { PROFILE_IDS, type ProfileId } from '../../src/core/types'
import { listConfirmations, listReports } from '../db'
import { HttpError, timeFrom, type ServerContext } from './context'

export function routeRouter(ctx: ServerContext): Router {
  const router = Router()
  const { db, campus } = ctx

  router.get('/route', (req, res) => {
    const from = String(req.query.from ?? '')
    const to = String(req.query.to ?? '')
    const profile = String(req.query.profile ?? 'wheelchair')
    const graph = graphFor(campus)
    if (!graph.nodeById.has(from)) throw new HttpError(400, `Unknown or missing "from": ${from}`)
    if (!graph.nodeById.has(to)) throw new HttpError(400, `Unknown or missing "to": ${to}`)
    if (!(PROFILE_IDS as readonly string[]).includes(profile)) {
      throw new HttpError(400, `profile must be one of ${PROFILE_IDS.join(', ')}`)
    }
    const now = timeFrom(req)
    const result = findRoute(
      { campus, reports: listReports(db, campus.areaId), confirmations: listConfirmations(db, campus.areaId), now },
      { from, to, profile: profile as ProfileId },
    )
    res.json(result)
  })

  router.get('/campus', (_req, res) => {
    res.json(campus)
  })

  return router
}
