// Every start and destination, said aloud with every combination of profiles, must be understood exactly.

import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { PROFILE_IDS, type ProfileId } from '../core/types'
import { parseRoute } from './parseRoute'

const campus = loadCampus(campusData)
const COMBOS: ProfileId[][] = Array.from({ length: 2 ** PROFILE_IDS.length - 1 }, (_, i) => i + 1).map((mask) =>
  PROFILE_IDS.filter((_, bit) => (mask >> bit) & 1),
)

const SAY: Record<ProfileId, string> = { wheelchair: 'wheelchair', crutches: 'crutches', low_vision: 'low vision' }

function joinWords(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

describe('every place and profile combination, spoken', () => {
  it('understands "from A to B for <profiles>" for all 210 pairs and all 7 combinations', () => {
    let checked = 0
    for (const a of campus.nodes) {
      for (const b of campus.nodes) {
        if (a.id === b.id) continue
        for (const combo of COMBOS) {
          const text = `From ${a.name} to ${b.name} for ${joinWords(combo.map((p) => SAY[p]))}`
          const parsed = parseRoute(text, campus)
          expect([parsed.from, parsed.to, parsed.profiles, parsed.problems], text).toEqual([a.id, b.id, combo, []])
          checked++
        }
      }
    }
    expect(checked).toBe(1470)
  })

  it('understands each place alone as a destination, in lower case, and by the first word of its name', () => {
    for (const place of campus.nodes) {
      expect(parseRoute(`take me to the ${place.name.toLowerCase()}`, campus).to, place.name).toBe(place.id)
    }
    // Names that share no first word with another place are also understood by that word alone.
    const firstWords = campus.nodes.map((n) => n.name.toLowerCase().split(' ')[0])
    for (const place of campus.nodes) {
      const first = place.name.toLowerCase().split(' ')[0]
      if (firstWords.filter((w) => w === first).length === 1) expect(parseRoute(`go to ${first}`, campus).to, place.name).toBe(place.id)
    }
  })
})
