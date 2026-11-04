// What a person says on the welcome page: which way they want to use REACHABLE.
// Pure: no DOM, no network. The person chooses; nothing here guesses from anything but the words they said.

import { plain } from './commands'

export type Experience = 'voice' | 'map'

const VOICE_WORDS = [
  'blind',
  'low vision',
  'visually impaired',
  'vision impaired',
  'partially sighted',
  'partial sight',
  'poor eyesight',
  'poor sight',
  'voice',
  'voice guide',
  'audio',
  'speak',
  'speaking',
  'screen reader',
  'cannot see',
  'can not see',
  'can t see',
  'talk',
]

const MAP_WORDS = ['campus map', 'map', 'other', 'wheelchair', 'wheel chair', 'crutches', 'crutch', 'normal', 'sighted', 'visual', 'see the map']

const has = (text: string, word: string) => new RegExp(String.raw`(?:^| )${word}(?: |$)`).test(text)

/**
 * 'voice' for the spoken guide, 'map' for the campus map, or null when it is neither or both
 * (so the person is asked again instead of being sent somewhere they did not choose).
 */
export function chooseExperience(spoken: string): Experience | null {
  const text = plain(spoken)
  // "partially sighted" and "cannot see" are voice answers; the bare word "sighted" is not.
  const voice = VOICE_WORDS.some((w) => has(text, w))
  const map = MAP_WORDS.some((w) => has(text, w) && !(w === 'sighted' && voice) && !(w === 'visual' && voice))
  if (voice && !map) return 'voice'
  if (map && !voice) return 'map'
  return null
}
