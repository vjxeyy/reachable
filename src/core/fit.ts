// "Is this route good to travel for this person?" A plain-language check of a route against the
// profile: slope, width, steps, length, and what the reports on it mean for that person.
// It never makes a route safer than it is: it only explains where the route is hard.
// No React, no network. Takes the campus, the route and the profile.

import { describePath, graphFor } from './graph'
import type { Profile } from './profiles'
import type { ReportImpact } from './route'
import type { Campus } from './types'

export type FitVerdict = 'good' | 'caution' | 'not_advised'

export interface FitNote {
  /** The path the note is about. */
  pathId: string
  level: 'info' | 'warn'
  text: string
}

export interface RouteFit {
  verdict: FitVerdict
  /** One line for the person, e.g. "Not advised for Low vision on its own." */
  headline: string
  notes: FitNote[]
}

/** A wheelchair-width margin below this is called tight. */
const TIGHT_MARGIN_M = 0.3
/** A slope this close to the profile's limit is called steep for that person. */
const STEEP_SHARE = 0.75

interface Leg {
  pathId: string
  impacts: readonly ReportImpact[]
}

function metres(value: number): string {
  return `${Number(value.toFixed(2))} m`
}

export function assessRoute(campus: Campus, legs: readonly Leg[], profile: Profile): RouteFit {
  const graph = graphFor(campus)
  const notes: FitNote[] = []
  let notAdvised = false

  for (const leg of legs) {
    const path = graph.pathById.get(leg.pathId)
    if (!path) continue
    const where = describePath(campus, leg.pathId)
    const add = (level: FitNote['level'], text: string) => notes.push({ pathId: leg.pathId, level, text: `${where}: ${text}` })

    if (!path.stepFree) add('warn', 'has steps. Take them slowly and use the handrail if there is one.')
    if (profile.maxSlopePct !== null && path.slopePct >= profile.maxSlopePct * STEEP_SHARE) {
      add('warn', `steep for this profile, ${path.slopePct}% against a limit of ${profile.maxSlopePct}%.`)
    } else if (profile.slopeBands.some((b) => path.slopePct >= b.minPct && path.slopePct <= b.maxPct)) {
      add('info', `a ${path.slopePct}% slope, harder going than level ground.`)
    }
    if (profile.minWidthM !== null && path.widthM - profile.minWidthM < TIGHT_MARGIN_M) {
      add('warn', `tight, ${metres(path.widthM)} wide against a ${metres(profile.minWidthM)} minimum.`)
    } else if (profile.narrowPaths.some((r) => path.widthM < r.underM)) {
      add('info', `narrow, ${metres(path.widthM)} wide.`)
    }
    if (profile.longPaths.some((r) => path.lengthM > r.overM)) add('info', `a long stretch, ${path.lengthM} m without a break.`)

    for (const impact of leg.impacts) {
      if (impact.effect === 'outdated') {
        add('info', 'an old report here may be out of date, but check on site.')
      } else if (impact.effect === 'unverified_block') {
        add('warn', 'reported as fully blocked and not yet verified by the admin. It may be impassable, so check before you go.')
      } else if (impact.effect === 'partial') {
        if (profile.activeObstacleBlocks) {
          notAdvised = true
          add('warn', 'partly blocked. With low vision a partial blockage is hard to judge by sight, so do not go alone.')
        } else if (profile.minWidthM !== null) {
          add(
            'warn',
            `partly blocked and the gap left is not known. The path is ${metres(path.widthM)} wide and you need ${metres(profile.minWidthM)}, so look before you commit.`,
          )
        } else {
          add('warn', 'partly blocked. Go slowly, and expect uneven ground or a detour around it.')
        }
      }
    }
  }

  const name = profile.name
  const hasWarning = notes.some((n) => n.level === 'warn')
  if (notAdvised) {
    return { verdict: 'not_advised', headline: `Not advised for ${name} on its own.`, notes }
  }
  if (hasWarning) {
    return { verdict: 'caution', headline: `Possible for ${name}, but only with care.`, notes }
  }
  return { verdict: 'good', headline: `No problem found for ${name} on this route.`, notes }
}
