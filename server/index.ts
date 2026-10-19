// REACHABLE API server: Express + SQLite. Routing and trust logic come from src/core, shared with
// the browser. Run with `npm run server` (dev) or `npm start` (also serves the built frontend).

import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import campusData from '../data/campus.json'
import { loadCampus } from '../src/core/graph'
import { authConfigFromEnv, createAuth } from './auth'
import { buildServerClassifier } from './classifier-config'
import { DEFAULT_DB_PATH, openDb, seedCampus } from './db'
import { authRouter } from './routes/auth'
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
  // Behind Render's proxy: use the real client address (for the login limits) and know when the request was HTTPS.
  app.set('trust proxy', 1)

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', options.corsOrigin || '*')
    // The login cookie crosses origins only when one origin is named, never with the wildcard.
    if (options.corsOrigin) res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') res.sendStatus(204)
    else next()
  })
  app.use(express.json({ limit: '100kb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, areaId: ctx.campus.areaId, campus: ctx.campus.name, classifier: ctx.classifier.name })
  })
  app.use('/api', authRouter(ctx))
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
  const chosen = buildServerClassifier(process.env, path.join(path.dirname(dbPath), 'models'))
  if (chosen.clipRuntime) {
    const started = Date.now()
    chosen.clipRuntime.warmUp().then(
      () => console.log(`CLIP model ready in ${((Date.now() - started) / 1000).toFixed(1)} s`),
      (error: unknown) => console.error('CLIP model could not load; using the demo classifier:', error instanceof Error ? error.message : error),
    )
  }
  const auth = createAuth(authConfigFromEnv(process.env))
  const app = createApp(
    { db, campus, uploadsDir, classifier: chosen.classifier, auth },
    { staticDir: path.join(root, 'dist'), corsOrigin: process.env.CORS_ORIGIN },
  )
  app.listen(port, () => {
    console.log(`REACHABLE API on http://localhost:${port}  (database: ${path.relative(root, dbPath)})`)
    console.log(chosen.description)
    console.log(
      auth.configured
        ? 'Admin login is set up.'
        : 'Admin login is NOT set up (set ADMIN_EMAIL and ADMIN_PASSWORD): admin actions are locked.',
    )
    if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 10) {
      console.warn('ADMIN_PASSWORD is shorter than 10 characters. Use a longer one.')
    }
  })
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
