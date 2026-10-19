// Runs the 60-second demo from PLAN.md section 1 against a running API server and checks each step.
//
//   npm run demo:check                       (server at http://localhost:8787)
//   npm run demo:check -- https://my-api.example.com
//
// It resets the demo before and after, so it removes any reports on that server. Use it on a
// demo or local server only. Resetting needs the admin login, so it signs in first with ADMIN_EMAIL and
// ADMIN_PASSWORD, taken from the environment or from .env (the same values the server uses).

try {
  process.loadEnvFile('.env')
} catch {
  // .env is optional.
}

const base = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:8787').replace(/\/$/, '')
const query = { from: 'library', to: 'hostel', profile: 'wheelchair' }
const voterId = 'demo-check-passer-by'
let failed = false
/** The admin's session cookie, once signed in. */
let cookie = ''

async function call(method, path, body) {
  const isForm = body instanceof FormData
  const headers = { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${data.error ?? ''}`)
  const setCookie = response.headers.get('set-cookie')
  if (setCookie && path === '/api/auth/login') cookie = setCookie.split(';')[0]
  return data
}

/** Resetting the demo needs the admin login, so sign in first. */
async function signIn() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (in the environment or .env) so the check can sign in and reset the demo.')
  }
  await call('POST', '/api/auth/login', { email, password })
}

const route = () => call('GET', `/api/route?from=${query.from}&to=${query.to}&profile=${query.profile}`)

function check(step, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}

async function report(pathId, fileName) {
  // A tiny JPEG stands in for the photo; the server suggests a category and we "confirm" it.
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
  const classify = new FormData()
  classify.append('photo', photo, fileName)
  const suggestion = await call('POST', '/api/classify', classify)
  const form = new FormData()
  for (const [key, value] of Object.entries({
    pathId,
    category: suggestion.category,
    severity: 'blocked',
    confidence: suggestion.confidence,
    aiCategory: suggestion.category,
    reporterId: 'demo-check-reporter',
    description: 'Reported by scripts/demo-check.mjs',
  })) {
    form.append(key, String(value))
  }
  form.append('photo', photo, fileName)
  const { report } = await call('POST', '/api/reports', form)
  return { report, suggestion }
}

try {
  await call('GET', '/api/health')
  await signIn()
  await call('POST', '/api/demo/reset', { at: Date.now() })
  const campus = await call('GET', '/api/campus')
  const pathById = new Map(campus.paths.map((p) => [p.id, p]))
  const name = (pathId) => {
    const p = pathById.get(pathId)
    const node = (id) => campus.nodes.find((n) => n.id === id)?.name ?? id
    return `${node(p.from)} to ${node(p.to)}`
  }

  // 1. Wheelchair, Library to Hostel: a step-free route.
  const r1 = await route()
  check(
    '1. Wheelchair route Library to Hostel is step-free',
    r1.status === 'ok' && r1.route.stepFree && r1.route.verification === 'verified',
    r1.status === 'ok' ? `${r1.route.lengthM} m via ${r1.route.pathIds.map(name).join(', ')}` : r1.status,
  )
  const original = r1.route.pathIds
  const rampId = original.find((id) => {
    const p = pathById.get(id)
    return p.stepFree && p.slopePct >= 5 && p.slopePct <= 8
  })

  // 2. Report a blocked ramp on that route (photo, AI suggestion, user confirms).
  const ramp = await report(rampId, 'sample-blocked-ramp.jpg')
  check(
    '2. Blocked ramp reported with an AI suggestion',
    ramp.suggestion.category === 'blocked_ramp' && ramp.report.status === 'unverified',
    `${ramp.suggestion.source === 'simulated' ? 'AI suggestion (demo)' : ramp.suggestion.model}: ${ramp.suggestion.category} ${Math.round(ramp.suggestion.confidence * 100)}%, on ${name(rampId)}`,
  )

  // 3. The route redraws through a longer step-free path, with a reason.
  const r3 = await route()
  check(
    '3. Route redraws on a longer step-free path, with the reason',
    r3.status === 'ok' &&
      r3.route.stepFree &&
      !r3.route.pathIds.includes(rampId) &&
      r3.route.lengthM > r1.route.lengthM &&
      r3.reroute?.because.some((i) => i.reportId === ramp.report.id),
    r3.status === 'ok' ? `+${r3.reroute?.extraM} m via ${r3.route.pathIds.map(name).join(', ')}` : r3.status,
  )

  // 4. Report a second block on the new route: no verified route is left.
  const secondPathId = r3.route.pathIds.find((id) => !original.includes(id))
  const second = await report(secondPathId, 'sample-flooding.jpg')
  const r4 = await route()
  check(
    '4. Second block gives "No verified step-free route"',
    r4.status === 'no_verified_route' &&
      r4.message === 'No verified step-free route' &&
      r4.alternative?.label === 'Unverified, use with caution',
    r4.status === 'no_verified_route'
      ? `blocked by ${r4.blockedBy.length} reports; unverified option offered separately, not as the route`
      : r4.status,
  )
  void second

  // 5. Mark one obstacle cleared: the route returns.
  await call('POST', `/api/reports/${ramp.report.id}/clear`, { voterId })
  const r5 = await route()
  check(
    '5. Clearing the ramp brings the route back',
    r5.status === 'ok' && JSON.stringify(r5.route.pathIds) === JSON.stringify(original),
    r5.status === 'ok' ? `${r5.route.lengthM} m via ${r5.route.pathIds.map(name).join(', ')}` : r5.status,
  )
} catch (error) {
  failed = true
  console.error(`FAIL ${error.message}`)
  if (String(error.message).includes('fetch failed')) console.error(`  Is the API running at ${base}? Try: npm run server`)
} finally {
  try {
    await call('POST', '/api/demo/reset', { at: Date.now() })
  } catch {
    // Server unreachable; nothing to reset.
  }
}

console.log(failed ? '\nDemo check FAILED' : '\nAll 5 demo steps passed. Demo data has been reset.')
process.exitCode = failed ? 1 : 0
