// Runs the real CLIP model on the three sample drawings and prints what it suggests.
//   npm run clip:check
// The first run downloads the model (about 90 MB) into server/data/models.

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClipClassifier } from '../src/classifier/clip'
import { createClipRuntime } from '../server/clip-backend'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expected: Record<string, string> = { 'blocked-ramp': 'blocked_ramp', 'parked-vehicle': 'parked_vehicle', flooding: 'flooding' }

const runtime = createClipRuntime(path.join(root, 'server', 'data', 'models'))
const classifier = createClipClassifier(runtime)
let t = Date.now()
await runtime.warmUp()
console.log(`Model ready in ${((Date.now() - t) / 1000).toFixed(1)} s (memory ${Math.round(process.memoryUsage().rss / 1e6)} MB)\n`)

let wrong = 0
for (const [name, want] of Object.entries(expected)) {
  const jpeg = await sharp(readFileSync(path.join(root, 'public', 'samples', `${name}.svg`))).resize(720).jpeg().toBuffer()
  t = Date.now()
  const result = await classifier.classify({ image: new Uint8Array(jpeg), mimeType: 'image/jpeg', fileName: `${name}.jpg` })
  const ok = result.category === want
  if (!ok) wrong++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(15)} -> ${result.category} ${Math.round(result.confidence * 100)}%  (${Date.now() - t} ms)`)
}
process.exit(wrong ? 1 : 0)
