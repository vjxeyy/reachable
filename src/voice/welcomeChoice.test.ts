import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { chooseExperience } from './welcomeChoice'

const campus = loadCampus(campusData)

describe('chooseExperience', () => {
  it('hears the voice guide in several ways', () => {
    for (const text of [
      'blind or low vision',
      'Blind',
      'low vision',
      'I am blind',
      'i am visually impaired',
      'partially sighted',
      'the voice guide',
      'voice',
      'I cannot see',
      "I can't see",
      'i use a screen reader',
      'audio please',
    ]) {
      expect([text, chooseExperience(text)]).toEqual([text, 'voice'])
    }
  })

  it('hears the campus map in several ways', () => {
    for (const text of ['campus map', 'Campus map.', 'the map', 'map please', 'other', 'wheelchair', 'I use crutches', 'normal', 'sighted']) {
      expect([text, chooseExperience(text)]).toEqual([text, 'map'])
    }
  })

  it('asks again when both or neither are said', () => {
    expect(chooseExperience('blind or the campus map')).toBeNull()
    expect(chooseExperience('')).toBeNull()
    expect(chooseExperience('purple elephant')).toBeNull()
    expect(chooseExperience('yes')).toBeNull()
  })

  it('does not turn a place name into a choice', () => {
    for (const place of campus.nodes) expect([place.name, chooseExperience(place.name)]).toEqual([place.name, null])
  })

  it('is the same every time', () => {
    expect(chooseExperience('low vision')).toBe(chooseExperience('low vision'))
  })
})
