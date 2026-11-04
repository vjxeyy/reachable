import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { parseRoute } from './parseRoute'

// Tests may name ids from the campus fixture. The parser itself never does.
const campus = loadCampus(campusData)

describe('parseRoute: what the person said', () => {
  it('understands "From hostel to canteen"', () => {
    expect(parseRoute('From hostel to canteen', campus)).toEqual({ heard: 'From hostel to canteen', from: 'hostel', to: 'canteen', profiles: [], problems: [] })
  })

  it('understands the same request in other shapes', () => {
    for (const text of ['hostel to canteen', 'Route from the Hostel to the Canteen please', 'take me to the canteen from the hostel', 'from hostel, to canteen.']) {
      const parsed = parseRoute(text, campus)
      expect([parsed.from, parsed.to, parsed.problems.length]).toEqual(['hostel', 'canteen', 0])
    }
  })

  it('takes a single place after "to" as the destination, and one after "from" as the start', () => {
    expect(parseRoute('go to the library', campus)).toMatchObject({ from: '', to: 'library', problems: [] })
    expect(parseRoute('take me to health centre', campus)).toMatchObject({ from: '', to: 'health' })
    expect(parseRoute('from main gate', campus)).toMatchObject({ from: 'gate', to: '' })
    expect(parseRoute('library', campus)).toMatchObject({ from: '', to: 'library' })
  })

  it('hears "two" and "too" as "to"', () => {
    expect(parseRoute('from hostel two canteen', campus)).toMatchObject({ from: 'hostel', to: 'canteen' })
  })

  it('matches by part of a name, a plural or a different spelling', () => {
    expect(parseRoute('from admin to lecture hall', campus)).toMatchObject({ from: 'admin', to: 'lecture' })
    expect(parseRoute('from the health center to the bus stop', campus)).toMatchObject({ from: 'health', to: 'busstop' })
    expect(parseRoute('from parking lot to sports', campus)).toMatchObject({ from: 'parking', to: 'sports' })
  })

  it('forgives a close mis-hearing', () => {
    expect(parseRoute('from hostle to cantin', campus)).toMatchObject({ from: 'hostel', to: 'canteen', problems: [] })
  })

  it('leaves a place empty and says so when it is not recognised', () => {
    const parsed = parseRoute('from hostel to the moon', campus)
    expect(parsed.from).toBe('hostel')
    expect(parsed.to).toBe('')
    expect(parsed.problems).toEqual(['I did not recognise "moon" as a place.'])
  })

  it('does not guess when a word fits two places', () => {
    const parsed = parseRoute('from block to canteen', campus)
    expect(parsed.from).toBe('')
    expect(parsed.to).toBe('canteen')
    expect(parsed.problems).toEqual(['"block" could be Admin Block or Lab Block.'])
  })

  it('refuses a start and a destination that are the same place', () => {
    const parsed = parseRoute('from library to library', campus)
    expect(parsed.from).toBe('library')
    expect(parsed.to).toBe('')
    expect(parsed.problems[0]).toMatch(/same place/)
  })

  it('says what to try when no place was heard at all', () => {
    expect(parseRoute('hello there', campus).problems.length).toBeGreaterThan(0)
    expect(parseRoute('', campus)).toMatchObject({ from: '', to: '' })
    expect(parseRoute('', campus).problems.length).toBeGreaterThan(0)
  })

  it('gives the same answer every time', () => {
    expect(parseRoute('from hostle to cantin', campus)).toEqual(parseRoute('from hostle to cantin', campus))
  })
})

describe('parseRoute: who the route is for', () => {
  const said = (text: string) => {
    const p = parseRoute(text, campus)
    return [p.from, p.to, p.profiles.join('+'), p.problems.length] as const
  }

  it('hears one profile at the end or the start', () => {
    expect(said('from hostel to canteen for wheelchair')).toEqual(['hostel', 'canteen', 'wheelchair', 0])
    expect(said('hostel to canteen with crutches')).toEqual(['hostel', 'canteen', 'crutches', 0])
    expect(said('wheelchair user from library to hostel')).toEqual(['library', 'hostel', 'wheelchair', 0])
    expect(said('for low vision take me to the library')).toEqual(['', 'library', 'low_vision', 0])
  })

  it('hears several profiles, joined by and, plus, also or a pause', () => {
    expect(said('from hostel to canteen for wheelchair and low vision')[2]).toBe('wheelchair+low_vision')
    expect(said('from hostel to canteen for crutches plus low vision')[2]).toBe('crutches+low_vision')
    expect(said('from hostel to canteen, wheelchair, also low vision')[2]).toBe('wheelchair+low_vision')
    expect(said('from hostel to canteen for crutches, low vision, wheelchair')[2]).toBe('wheelchair+crutches+low_vision')
  })

  it('keeps the places when the person describes themselves in a sentence', () => {
    expect(said('i use a wheelchair and i have low vision from library to hostel')).toEqual(['library', 'hostel', 'wheelchair+low_vision', 0])
    expect(said('from library to hostel, i am visually impaired')).toEqual(['library', 'hostel', 'low_vision', 0])
  })

  it('reads blind and partially sighted as low vision', () => {
    expect(said('i am blind take me to the library')).toEqual(['', 'library', 'low_vision', 0])
    expect(said('from admin to library partially sighted')[2]).toBe('low_vision')
  })

  it('never leaves a profile word in a place name', () => {
    const p = parseRoute('from hostel to canteen for wheelchair', campus)
    expect(p.problems).toEqual([])
    expect(p.to).toBe('canteen')
  })

  it('gives no profile when none is said, and the same order every time', () => {
    expect(parseRoute('from hostel to canteen', campus).profiles).toEqual([])
    expect(parseRoute('low vision wheelchair from hostel to canteen', campus).profiles).toEqual(['wheelchair', 'low_vision'])
    expect(parseRoute('wheelchair low vision from hostel to canteen', campus).profiles).toEqual(['wheelchair', 'low_vision'])
  })

  it('accepts a profile on its own as an answer, without complaining about missing places', () => {
    const p = parseRoute('wheelchair', campus)
    expect(p.profiles).toEqual(['wheelchair'])
    expect(p.problems).toEqual([])
  })
})


describe('parseRoute: an exact word beats a close sound', () => {
  it('"central" is Central Quad, and "centre" is Health Centre', () => {
    expect(parseRoute('go to central', campus)).toMatchObject({ to: 'quad', problems: [] })
    expect(parseRoute('go to the centre', campus)).toMatchObject({ to: 'health', problems: [] })
  })
})
