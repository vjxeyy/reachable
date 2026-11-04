// Live obstacle updates for the voice guide: when reports change the route being followed, what to say.
// Pure: no DOM, no network. It compares two results of the existing route engine and never works out a route itself.

import type { Route, RouteResult } from '../core/route'
import { isActive } from '../core/trust'
import type { Campus, Report } from '../core/types'
import { reportText, spokenDistance } from './directions'

/** Reports that are not cleared and not outdated: the ones that can change a route. Statuses must already be derived. */
function activeOn(reports: readonly Report[], pathIds: ReadonlySet<string>): Report[] {
  return reports.filter((r) => isActive(r.status) && pathIds.has(r.pathId))
}

/** A short fingerprint of an outcome. Same fingerprint means nothing the person needs to hear has changed. */
export function outcomeKey(result: RouteResult): string {
  if (result.status === 'ok') {
    const warn = result.route.warnings.map((w) => w.reportId).sort()
    return `ok|${result.route.verification}|${result.route.pathIds.join('>')}|${warn.join(',')}`
  }
  return `none|${result.reason}|${result.blockedBy.map((b) => b.reportId).sort().join(',')}`
}

function routePaths(result: RouteResult): Set<string> {
  return new Set(result.status === 'ok' ? result.route.pathIds : [])
}

/** Metres, said as "42 metres longer" or "42 metres shorter". */
function difference(before: Route, after: Route): string {
  const d = Math.round(after.lengthM - before.lengthM)
  if (d === 0) return 'It is the same length as before.'
  return `That is ${spokenDistance(Math.abs(d))} ${d > 0 ? 'longer' : 'shorter'} than before.`
}

export interface LiveChange {
  /** What to say, in order. */
  lines: string[]
  /** The route result after the change. */
  result: RouteResult
}

/**
 * What to say after reports changed, or null when the person does not need to hear anything.
 * `beforeReports` and `afterReports` must carry derived statuses. The alert names the report and its
 * verification status; then it says what the recalculation found, in the engine's own words.
 */
export function describeChange(args: {
  campus: Campus
  before: RouteResult
  after: RouteResult
  beforeReports: readonly Report[]
  afterReports: readonly Report[]
  now: number
}): LiveChange | null {
  const { campus, before, after, beforeReports, afterReports, now } = args
  if (outcomeKey(before) === outcomeKey(after)) return null

  const lines: string[] = []
  const paths = routePaths(before)
  const knownBefore = new Set(activeOn(beforeReports, paths).map((r) => r.id))
  const arrived = activeOn(afterReports, paths).filter((r) => !knownBefore.has(r.id))

  const stillActive = new Set(afterReports.filter((r) => isActive(r.status)).map((r) => r.id))
  const lifted = beforeReports.filter((r) => isActive(r.status) && !stillActive.has(r.id))

  if (arrived.length > 0) {
    lines.push(`Alert. ${arrived.length === 1 ? 'A new report affects' : 'New reports affect'} your route.`)
    for (const report of arrived.slice(0, 3)) lines.push(`${reportText(campus, report, now)}.`)
    if (arrived.length > 3) lines.push(`And ${arrived.length - 3} more.`)
  } else if (lifted.length > 0) {
    lines.push('Update. A report was cleared or has expired.')
    for (const report of lifted.slice(0, 2)) lines.push(`${reportText(campus, report, now)}.`)
  } else {
    lines.push('Update. Reports have changed.')
  }

  if (after.status === 'ok') {
    const length = spokenDistance(after.route.lengthM)
    if (before.status === 'ok') {
      lines.push(`I have recalculated. The new route is ${length}. ${difference(before.route, after.route)}`)
    } else {
      lines.push(`A route is available now, ${length}.`)
    }
  } else {
    const from = describeEnds(campus, after)
    lines.push(`There is no safe suitable route${from} now.`)
    lines.push(`${after.message.replace(/\s+/g, ' ').trim()}`)
    const blockers = after.blockedBy.slice(0, 2)
    if (blockers.length > 0) lines.push(`Blocked by: ${blockers.map((b) => reportText(campus, b, now)).join('; ')}.`)
  }
  return { lines: lines.map(endSentence), result: after }
}

function describeEnds(campus: Campus, result: RouteResult): string {
  const name = (id: string) => campus.nodes.find((n) => n.id === id)?.name ?? id
  return ` from ${name(result.query.from)} to ${name(result.query.to)}`
}

function endSentence(text: string): string {
  const t = text.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}
