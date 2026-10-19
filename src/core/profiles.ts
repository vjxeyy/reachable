// Mobility profiles and obstacle penalties (PLAN.md section 6).
// The numbers are the plan's starting values. Tune them here and nowhere else.

import type { CampusPath, ProfileId } from './types'

interface SlopeBand {
  /** Inclusive lower bound, percent. */
  minPct: number
  /** Inclusive upper bound, percent. */
  maxPct: number
  penalty: number
}

export interface Profile {
  id: ProfileId
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
  longPath: { overM: number; penalty: number } | null
  narrowPath: { underM: number; penalty: number } | null
  /** Penalty for a `partial` obstacle that is verified or unverified. */
  partialPenalty: number
  /** Low vision: any active obstacle counts as blocking, whatever its reported severity. */
  activeObstacleBlocks: boolean
}

export const PROFILES: Record<ProfileId, Profile> = {
  wheelchair: {
    id: 'wheelchair',
    name: 'Wheelchair',
    routeNoun: 'Step-free route',
    noVerifiedRouteText: 'No verified step-free route',
    requireStepFree: true,
    minWidthM: 0.9,
    maxSlopePct: 8,
    slopeBands: [{ minPct: 5, maxPct: 8, penalty: 30 }],
    longPath: null,
    narrowPath: null,
    partialPenalty: 60,
    activeObstacleBlocks: false,
  },
  crutches: {
    id: 'crutches',
    name: 'Crutches',
    routeNoun: 'Route for crutches',
    noVerifiedRouteText: 'No verified route for crutches',
    requireStepFree: false,
    minWidthM: null,
    maxSlopePct: 10,
    slopeBands: [{ minPct: 6, maxPct: 10, penalty: 25 }],
    longPath: { overM: 150, penalty: 10 },
    narrowPath: null,
    partialPenalty: 60,
    activeObstacleBlocks: false,
  },
  low_vision: {
    id: 'low_vision',
    name: 'Low vision',
    routeNoun: 'Low-vision route',
    noVerifiedRouteText: 'No verified low-vision route',
    requireStepFree: false,
    minWidthM: null,
    maxSlopePct: null,
    slopeBands: [],
    longPath: null,
    narrowPath: { underM: 1.5, penalty: 20 },
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
  if (profile.longPath && path.lengthM > profile.longPath.overM) penalty += profile.longPath.penalty
  if (profile.narrowPath && path.widthM < profile.narrowPath.underM) penalty += profile.narrowPath.penalty
  return penalty
}
