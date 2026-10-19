// Mobility profiles and obstacle penalties (PLAN.md section 6).
// The numbers are the plan's starting values. Tune them here and nowhere else.

import { PROFILE_IDS, type CampusPath, type ProfileId } from './types'

interface SlopeBand {
  /** Inclusive lower bound, percent. */
  minPct: number
  /** Inclusive upper bound, percent. */
  maxPct: number
  penalty: number
}

interface LongPathRule {
  overM: number
  penalty: number
}

interface NarrowPathRule {
  underM: number
  penalty: number
}

export interface Profile {
  /** The profiles this one stands for: one for a plain profile, several for a combination. */
  ids: readonly ProfileId[]
  name: string
  /** What a route is called for this profile, e.g. "Step-free route". */
  routeNoun: string
  /** Fail-safe message when no verified route exists. */
  noVerifiedRouteText: string
  // Hard rules: a path that breaks one is excluded.
  requireStepFree: boolean
  minWidthM: number | null
  maxSlopePct: number | null
  // Soft penalties added to the path cost.
  slopeBands: SlopeBand[]
  longPaths: LongPathRule[]
  narrowPaths: NarrowPathRule[]
  /** Penalty for a `partial` obstacle that is verified or unverified. */
  partialPenalty: number
  /** Low vision: any active obstacle counts as blocking, whatever its reported severity. */
  activeObstacleBlocks: boolean
}

export const PROFILES: Record<ProfileId, Profile> = {
  wheelchair: {
    ids: ['wheelchair'],
    name: 'Wheelchair',
    routeNoun: 'Step-free route',
    noVerifiedRouteText: 'No verified step-free route',
    requireStepFree: true,
    minWidthM: 0.9,
    maxSlopePct: 8,
    slopeBands: [{ minPct: 5, maxPct: 8, penalty: 30 }],
    longPaths: [],
    narrowPaths: [],
    partialPenalty: 60,
    activeObstacleBlocks: false,
  },
  crutches: {
    ids: ['crutches'],
    name: 'Crutches',
    routeNoun: 'Route for crutches',
    noVerifiedRouteText: 'No verified route for crutches',
    requireStepFree: false,
    minWidthM: null,
    maxSlopePct: 10,
    slopeBands: [{ minPct: 6, maxPct: 10, penalty: 25 }],
    longPaths: [{ overM: 150, penalty: 10 }],
    narrowPaths: [],
    partialPenalty: 60,
    activeObstacleBlocks: false,
  },
  low_vision: {
    ids: ['low_vision'],
    name: 'Low vision',
    routeNoun: 'Low-vision route',
    noVerifiedRouteText: 'No verified low-vision route',
    requireStepFree: false,
    minWidthM: null,
    maxSlopePct: null,
    slopeBands: [],
    longPaths: [],
    narrowPaths: [{ underM: 1.5, penalty: 20 }],
    partialPenalty: 30,
    activeObstacleBlocks: true,
  },
}

/** Obstacle penalties that do not depend on the profile. */
export const OBSTACLE_PENALTY = {
  /** `unverified` + `blocked`: usable only when nothing else is left. */
  unverifiedBlocked: 200,
  /** `outdated`: shown as a warning, no longer blocks. */
  outdated: 20,
} as const

export function getProfile(id: ProfileId): Profile {
  const profile = PROFILES[id]
  if (!profile) throw new Error(`Unknown profile: ${id}`)
  return profile
}

function listNames(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * One profile that is at least as strict as every profile in the list, for a person who needs
 * several at once (for example a wheelchair user with low vision).
 * Hard rules: step-free if any profile needs it, the widest minimum width, the gentlest maximum slope.
 * Penalties from every profile add up, except the partial-obstacle penalty (the largest counts)
 * and "any active obstacle blocks" (on if any profile has it).
 * Duplicates are dropped and the order is fixed, so the same set always gives the same route.
 * A single profile is returned as is, so its results do not change.
 */
export function combineProfiles(input: readonly ProfileId[]): Profile {
  const ids = PROFILE_IDS.filter((id) => input.includes(id))
  const unknown = input.find((id) => !PROFILE_IDS.includes(id))
  if (unknown !== undefined) throw new Error(`Unknown profile: ${unknown}`)
  if (ids.length === 0) throw new Error('Pick at least one profile')
  if (ids.length === 1) return getProfile(ids[0])

  const members = ids.map(getProfile)
  const widths = members.map((p) => p.minWidthM).filter((v): v is number => v !== null)
  const slopes = members.map((p) => p.maxSlopePct).filter((v): v is number => v !== null)
  const requireStepFree = members.some((p) => p.requireStepFree)
  const names = members.map((p) => p.name.toLowerCase())
  const joined = listNames(names).replace(/^./, (c) => c.toUpperCase())
  return {
    ids,
    name: joined,
    routeNoun: `${joined} route`,
    noVerifiedRouteText: requireStepFree
      ? 'No verified step-free route'
      : `No verified route for ${listNames(names)}`,
    requireStepFree,
    minWidthM: widths.length > 0 ? Math.max(...widths) : null,
    maxSlopePct: slopes.length > 0 ? Math.min(...slopes) : null,
    slopeBands: members.flatMap((p) => p.slopeBands),
    longPaths: members.flatMap((p) => p.longPaths),
    narrowPaths: members.flatMap((p) => p.narrowPaths),
    partialPenalty: Math.max(...members.map((p) => p.partialPenalty)),
    activeObstacleBlocks: members.some((p) => p.activeObstacleBlocks),
  }
}

/** A profile id or a list of them (a combination), as the router accepts it. */
export type ProfileInput = ProfileId | readonly ProfileId[]

export function resolveProfile(input: ProfileInput): Profile {
  return typeof input === 'string' ? getProfile(input) : combineProfiles(input)
}

/** Why this profile cannot use the path at all, or null if it can. */
export function hardExclusionReason(profile: Profile, path: CampusPath): string | null {
  if (profile.requireStepFree && !path.stepFree) return 'has steps'
  if (profile.minWidthM !== null && path.widthM < profile.minWidthM) {
    return `narrower than ${profile.minWidthM} m`
  }
  if (profile.maxSlopePct !== null && path.slopePct > profile.maxSlopePct) {
    return `steeper than ${profile.maxSlopePct}%`
  }
  return null
}

/** Soft penalty from the path's own shape (slope, length, width). */
export function profilePenalty(profile: Profile, path: CampusPath): number {
  let penalty = 0
  for (const band of profile.slopeBands) {
    if (path.slopePct >= band.minPct && path.slopePct <= band.maxPct) penalty += band.penalty
  }
  for (const rule of profile.longPaths) {
    if (path.lengthM > rule.overM) penalty += rule.penalty
  }
  for (const rule of profile.narrowPaths) {
    if (path.widthM < rule.underM) penalty += rule.penalty
  }
  return penalty
}
