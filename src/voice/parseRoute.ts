// Turns what the browser heard ("from hostel to canteen") into a start and a destination.
// Pure: no DOM, no network. Place names come from the campus data, never from this file.
// It never guesses silently: a place it cannot match, or that fits two places, is reported in `problems`
// and left empty so the person picks it in the review step.

import type { Campus } from '../core/types'

export interface ParsedRoute {
  /** The text as the browser heard it. */
  heard: string
  /** Node id, or '' when no place was understood (the same empty value the route pickers use). */
  from: string
  to: string
  /** Plain sentences for the person, e.g. 'I did not recognise "cantin" as a place.' */
  problems: string[]
}

type Match = { id: string } | { problem: string }

/** Lowercase, no punctuation, one space between words, spoken "two" or "too" read as "to", US spellings. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\bcenter\b/g, 'centre')
    .replace(/\b(too|two|2)\b/g, 'to')
    .replace(/\s+/g, ' ')
    .trim()
}

const FILLER = /\b(please|take me|bring me|i want to go|i want to|i need to go|i need to|i would like to go|navigate|directions|route|find|show me|how do i get|go|get)\b/g
const ARTICLES = /\b(the|a|an|my|at|in|near|area|building)\b/g

function tidy(phrase: string): string {
  return phrase.replace(FILLER, ' ').replace(ARTICLES, ' ').replace(/\s+/g, ' ').trim()
}

/** Edit distance between two words (insert, delete, substitute). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/** Two words count as the same when equal, one starts the other (hall, halls), or they differ by a mis-hearing. */
function sameWord(heard: string, name: string): boolean {
  if (heard === name) return true
  if (heard.length >= 3 && (name.startsWith(heard) || heard.startsWith(name))) return true
  if (heard.length >= 4 && name.length >= 4) return distance(heard, name) <= Math.floor(Math.min(heard.length, name.length) / 3)
  return false
}

function nameList(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** Finds the one place a spoken phrase means, or says why it could not. */
function matchPlace(phrase: string, campus: Campus): Match {
  const heard = tidy(phrase)
  if (!heard) return { problem: 'I did not hear a place name.' }
  const places = campus.nodes.map((n) => ({ id: n.id, name: n.name, key: normalise(n.name).replace(ARTICLES, ' ').replace(/\s+/g, ' ').trim() }))

  // 1. The phrase is, or contains, a whole place name ("parking lot" contains "parking"). The longest name wins.
  const whole = places.filter((p) => heard === p.key || ` ${heard} `.includes(` ${p.key} `))
  if (whole.length > 0) {
    const longest = Math.max(...whole.map((p) => p.key.length))
    const best = whole.filter((p) => p.key.length === longest)
    if (best.length === 1) return { id: best[0].id }
  }

  // 2. Every spoken word is the same as, or starts, a word of the name ("admin", "hall", "lab").
  const words = heard.split(' ')
  const byWords = places.filter((p) => {
    const nameWords = p.key.split(' ')
    return words.every((w) => nameWords.some((nw) => sameWord(w, nw)))
  })
  if (byWords.length === 1) return { id: byWords[0].id }
  if (byWords.length > 1) return { problem: `"${heard}" could be ${nameList(byWords.map((p) => p.name))}.` }

  // 3. A close mis-hearing of the whole name ("cantin" for Canteen).
  if (heard.length >= 4) {
    const scored = places
      .map((p) => ({ p, d: distance(heard.replace(/ /g, ''), p.key.replace(/ /g, '')) }))
      .filter(({ p, d }) => d <= Math.floor(p.key.replace(/ /g, '').length / 3))
      .sort((a, b) => a.d - b.d)
    if (scored.length === 1 || (scored.length > 1 && scored[0].d < scored[1].d)) return { id: scored[0].p.id }
    if (scored.length > 1) return { problem: `"${heard}" could be ${nameList(scored.slice(0, 3).map(({ p }) => p.name))}.` }
  }
  return { problem: `I did not recognise "${heard}" as a place.` }
}

/** Splits the sentence into the words after "from" and the words after "to". */
function split(text: string): { from: string; to: string } {
  const fromThenTo = /\bfrom\b(.*?)\bto\b(.*)$/.exec(text)
  if (fromThenTo) return { from: fromThenTo[1], to: fromThenTo[2] }
  const toThenFrom = /\bto\b(.*?)\bfrom\b(.*)$/.exec(text)
  if (toThenFrom) return { from: toThenFrom[2], to: toThenFrom[1] }
  const fromOnly = /\bfrom\b(.*)$/.exec(text)
  if (fromOnly) return { from: fromOnly[1], to: '' }
  const toOnly = /\bto\b(.*)$/.exec(text)
  if (toOnly) {
    const before = text.slice(0, toOnly.index)
    // "hostel to canteen": a place before "to" is the start. "take me to canteen" has none.
    return { from: tidy(before) ? before : '', to: toOnly[1] }
  }
  // A single place with no "from" or "to" is taken as the destination.
  return { from: '', to: text }
}

export function parseRoute(text: string, campus: Campus): ParsedRoute {
  const heard = text.trim()
  const parts = split(normalise(text))
  const problems: string[] = []
  let from = ''
  let to = ''

  if (tidy(parts.from)) {
    const m = matchPlace(parts.from, campus)
    if ('id' in m) from = m.id
    else problems.push(m.problem)
  }
  if (tidy(parts.to)) {
    const m = matchPlace(parts.to, campus)
    if ('id' in m) to = m.id
    else problems.push(m.problem)
  }
  if (!from && !to && problems.length === 0) problems.push('I did not hear a start or a destination. Try "from Hostel to Canteen".')
  if (from && from === to) {
    problems.push('The start and the destination are the same place.')
    to = ''
  }
  return { heard, from, to, problems }
}
