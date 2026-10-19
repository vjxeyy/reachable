// POST /classify: suggests a category for a photo. Uses the real model when the server has an API
// key, and the simulated classifier otherwise (or when the model fails or is slow).

import { Router } from 'express'
import multer from 'multer'
import type { ClassifyInput } from '../../src/classifier'
import { HttpError, type ServerContext } from './context'
import { MAX_PHOTO_BYTES } from './reports'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) done(null, true)
    else done(new HttpError(400, 'Photo must be a JPEG, PNG, WebP or GIF image'))
  },
})

function parseContext(raw: unknown): ClassifyInput['context'] {
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const slopePct = Number(value.slopePct)
    const widthM = Number(value.widthM)
    if (typeof value.stepFree !== 'boolean' || !Number.isFinite(slopePct) || !Number.isFinite(widthM)) return undefined
    return { stepFree: value.stepFree, slopePct, widthM }
  } catch {
    return undefined
  }
}

export function classifyRouter(ctx: ServerContext): Router {
  const router = Router()
  router.post('/classify', upload.single('photo'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'photo is required')
    const result = await ctx.classifier.classify({
      image: new Uint8Array(req.file.buffer),
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      context: parseContext((req.body as Record<string, unknown> | undefined)?.context),
    })
    res.json(result)
  })
  return router
}
