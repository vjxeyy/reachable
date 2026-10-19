// REACHABLE API server: Express + SQLite. Routing and trust logic come from src/core, shared with
// the browser. Run with `npm run server` (dev) or `npm start` (also serves the built frontend).

import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import campusData from '../data/campus.json'
import { withFallback, type Classifier } from '../src/classifier'
import { createRealClassifier } from '../src/classifier/real'
import { simulatedClassifier } from '../src/classifier/simulated'
import { loadCampus } from '../src/core/graph'
import { DEFAULT_DB_PATH, openDb, seedCampus } from './db'
import { classifyRouter } from './routes/classify'
import { HttpError, type ServerContext } from './routes/context'
import { demoRouter, seedDemoIfNew } from './routes/demo'
import { reportsRouter } from './routes/reports'
import { routeRouter } from './routes/route'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

export interface AppOptions {
  /** Built frontend to serve (dist/). Skipped when missing. */
  staticDir?: string
  /** Allowed browser origin for the API, e.g. the deployed frontend URL. Default: any. */
  corsOrigin?: string
}

export function createApp(ctx: ServerContext, options: AppOptions = {}) {
  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', options.corsOrigin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') res.sendStatus(204)
    else next()
  })
  app.use(express.json({ limit: '100kb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, areaId: ctx.campus.areaId, campus: ctx.campus.name, classifier: ctx.classifier.name })
  })
  app.use('/api', reportsRouter(ctx))
  app.use('/api', routeRouter(ctx))
  app.use('/api', classifyRouter(ctx))
  app.use('/api', demoRouter(ctx))
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
  app.use('/uploads', express.static(ctx.uploadsDir, { maxAge: '1h', fallthrough: false }))

  const staticDir = options.staticDir
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir))
    app.use((req, res, next) => {
      if (req.method === 'GET') res.sendFile(path.join(staticDir, 'index.html'))
      else next()
    })
  }

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })
    } else if (error instanceof multer.MulterError) {
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.message })
    } else if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON body' })
    } else if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404) {
      res.status(404).json({ error: 'Not found' })
    } else {
      console.error(error)
      res.status(500).json({ error: 'Server error' })
    }
  })
  return app
}

/** Classifier used by /api/classify: the real model when a key is set, always with the simulated fallback. */
export function serverClassifier(apiKey: string | undefined): Classifier {
  const key = apiKey?.trim()
  const real = key ? createRealClassifier({ apiKey: key, timeoutMs: 5000 }) : null
  return withFallback(real, simulatedClassifier, {
    timeoutMs: 5000,
    missingNote: 'Demo classifier: the server has no ANTHROPIC_API_KEY set.',
    failurePrefix: 'Real model unavailable',
  })
}

function main(): void {
  try {
    process.loadEnvFile(path.join(root, '.env'))
  } catch {
    // .env is optional.
  }
  const port = Number(process.env.PORT ?? 8787)
  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH
  const uploadsDir = process.env.UPLOADS_DIR ?? path.join(root, 'uploads')
  mkdirSync(path.dirname(dbPath), { recursive: true })
  mkdirSync(uploadsDir, { recursive: true })

  const campus = loadCampus(campusData)
  const db = openDb(dbPath)
  seedCampus(db, campus)
  if (seedDemoIfNew(db, campus.areaId)) console.log('Loaded the example reports into a new database.')
  const app = createApp(
    { db, campus, uploadsDir, classifier: serverClassifier(process.env.ANTHROPIC_API_KEY) },
    { staticDir: path.join(root, 'dist'), corsOrigin: process.env.CORS_ORIGIN },
  )
  app.listen(port, () => {
    console.log(`REACHABLE API on http://localhost:${port}  (database: ${path.relative(root, dbPath)})`)
    console.log(process.env.ANTHROPIC_API_KEY ? 'Photo classifier: Claude (falls back to simulated)' : 'Photo classifier: simulated (no ANTHROPIC_API_KEY)')
  })
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
