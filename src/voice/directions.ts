// Spoken directions for a route: short steps that are read aloud and also shown on screen.
// Pure: no DOM, no network. Built only from the route, the campus data and the reports already on the route.
// It never calls a route accessible. A route that is not verified says so in its first sentence.

import { describePath, graphFor, pathKind } from '../core/graph'
import type { ReportImpact, Reroute, Route } from '../core/route'
import type { Campus } from '../core/types'
import { CATEGORY_LABEL, STATUS_LABEL } from '../components/labels'

export interface DirectionsContext {
  now: number
  /** Why the route differs from the usual one, if reports moved it. */
  reroute?: Reroute | null
}

/** "120 metres", "1.2 kilometres". Spoken, so no unit symbols. */
export function spokenDistance(m: number): string {
  if (m >= 1000) return `${Number((m / 1000).toFixed(2))} kilometres`
  const rounded = Math.round(m)
  return `${rounded} ${rounded === 1 ? 'metre' : 'metres'}`
}

function spokenAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  return `${Math.floor(hours / 24)} days ago`
}

/** Makes a written note readable by a speech voice: "6%" and "1.2 m" become words, "·" becomes a comma. */
export function speakable(text: string): string {
  return text
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
    .replace(/(\d+(?:\.\d+)?)\s*m\b/g, (_, n: string) => `${n} ${n === '1' ? 'metre' : 'metres'}`)
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sentence(text: string): string {
  const t = text.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}

function impactText(campus: Campus, impact: ReportImpact, now: number): string {
  const where = describePath(campus, impact.pathId)
  const kind = impact.severity === 'blocked' ? 'reported as blocked' : 'reported as partly blocked'
  return `${CATEGORY_LABEL[impact.category]} on ${where}, ${kind}, ${STATUS_LABEL[impact.status].toLowerCase()}, reported ${spokenAgo(now - impact.createdAt)}`
}

/**
 * The steps to read, in order: what kind of route it is, whether it suits the person, why it changed,
 * one step per leg with its difficulties and reports, and the arrival. Same input gives the same steps.
 */
export function directionsFor(campus: Campus, route: Route, context: DirectionsContext): string[] {
  const graph = graphFor(campus)
  const name = (id: string) => graph.nodeById.get(id)?.name ?? id
  const steps: string[] = []

  const last = route.nodeIds[route.nodeIds.length - 1]
  const destination = last ? name(last) : 'your destination'

  if (route.legs.length === 0) return [`You are already at ${destination}.`]

  const intro = [sentence(`${route.label}, ${spokenDistance(route.lengthM)}`)]
  if (route.verification !== 'verified') intro.push('This is not a verified route.')
  intro.push(sentence(route.fit.headline))
  steps.push(intro.join(' '))

  const cautions = route.fit.notes.filter((n) => n.level === 'warn')
  if (cautions.length > 0) {
    steps.push(`Take care. ${cautions.map((n) => sentence(speakable(n.text))).join(' ')}`)
  }

  const { reroute } = context
  if (reroute && reroute.because.length > 0) {
    const reasons = reroute.because.map((i) => impactText(campus, i, context.now)).join('; ')
    steps.push(sentence(`Rerouted, ${spokenDistance(reroute.extraM)} longer than usual, to avoid ${reasons}`))
  }

  route.legs.forEach((leg, i) => {
    const path = graph.pathById.get(leg.pathId)
    const parts = [`Step ${i + 1} of ${route.legs.length}. From ${name(leg.from)} to ${name(leg.to)}, ${spokenDistance(leg.lengthM)}.`]
    const kind = path ? pathKind(path) : 'path'
    if (kind === 'steps') parts.push('Has steps.')
    else if (path && kind === 'ramp') parts.push(`A ramp, with a ${path.slopePct} percent slope.`)
    else if (path && kind === 'steep') parts.push(`Step-free but steep, a ${path.slopePct} percent slope.`)
    if (path && path.widthM < 1.5) parts.push(`Narrow, ${path.widthM} metres wide.`)
    for (const impact of leg.impacts) parts.push(sentence(`Reported here: ${impactText(campus, impact, context.now)}`))
    steps.push(parts.join(' '))
  })

  steps.push(`You have arrived at ${destination}. Conditions change, so check on site.`)
  return steps
}
