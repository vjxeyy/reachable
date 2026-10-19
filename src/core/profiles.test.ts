import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from './graph'
import { combineProfiles, PROFILES, profilePenalty, resolveProfile } from './profiles'

const campus = loadCampus(campusData)
const pathById = new Map(campus.paths.map((p) => [p.id, p]))

describe('combineProfiles', () => {
  it('returns a single profile untouched, so single-profile routing cannot change', () => {
    expect(combineProfiles(['wheelchair'])).toBe(PROFILES.wheelchair)
    expect(resolveProfile('crutches')).toBe(PROFILES.crutches)
    expect(resolveProfile(['low_vision'])).toBe(PROFILES.low_vision)
  })

  it('wheelchair + low vision keeps every hard rule and adds the low-vision rules', () => {
    const p = combineProfiles(['wheelchair', 'low_vision'])
    expect(p.requireStepFree).toBe(true)
    expect(p.minWidthM).toBe(0.9)
    expect(p.maxSlopePct).toBe(8)
    expect(p.slopeBands).toEqual(PROFILES.wheelchair.slopeBands)
    expect(p.narrowPaths).toEqual(PROFILES.low_vision.narrowPaths)
    expect(p.partialPenalty).toBe(60)
    expect(p.activeObstacleBlocks).toBe(true)
    expect(p.noVerifiedRouteText).toBe('No verified step-free route')
    expect(p.name).toBe('Wheelchair and low vision')
  })

  it('takes the strictest hard rule: smallest slope limit, widest minimum width', () => {
    const p = combineProfiles(['wheelchair', 'crutches'])
    expect(p.maxSlopePct).toBe(8)
    expect(p.minWidthM).toBe(0.9)
    expect(p.requireStepFree).toBe(true)
    expect(combineProfiles(['crutches', 'low_vision']).maxSlopePct).toBe(10)
    expect(combineProfiles(['crutches', 'low_vision']).minWidthM).toBeNull()
  })

  it('adds the soft penalties of every profile', () => {
    const p = combineProfiles(['wheelchair', 'crutches'])
    // The 7% ramp sits in both slope bands (+30 and +25); 230 m is over the 150 m crutch limit (+10).
    const ramp = pathById.get('p-canteen-hostel-ramp')!
    expect(profilePenalty(p, ramp)).toBe(
      profilePenalty(PROFILES.wheelchair, ramp) + profilePenalty(PROFILES.crutches, ramp),
    )
    expect(profilePenalty(p, ramp)).toBe(30 + 25 + 10)
  })

  it('ignores order and duplicates', () => {
    expect(combineProfiles(['low_vision', 'wheelchair', 'low_vision'])).toEqual(
      combineProfiles(['wheelchair', 'low_vision']),
    )
    expect(combineProfiles(['crutches', 'crutches'])).toBe(PROFILES.crutches)
  })

  it('uses a plain fail-safe text when no step-free rule applies', () => {
    expect(combineProfiles(['crutches', 'low_vision']).noVerifiedRouteText).toBe(
      'No verified route for crutches and low vision',
    )
    expect(combineProfiles(['wheelchair', 'crutches', 'low_vision']).noVerifiedRouteText).toBe(
      'No verified step-free route',
    )
  })

  it('rejects an empty or unknown list', () => {
    expect(() => combineProfiles([])).toThrow(/at least one/i)
    expect(() => resolveProfile(['wheelchair', 'jetpack' as never])).toThrow(/Unknown profile/)
  })
})
