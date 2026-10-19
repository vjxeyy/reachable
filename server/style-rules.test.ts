// Keeps the design rules from slipping back in. It reads the source files (never the database) and
// fails with the file and line of every offence.
//
// The rules: no purple or indigo, no gradients, no pill-shaped controls, no emoji or glyph icons
// (arrows, ticks, crosses), no em or en dashes, no cursor effects or scroll-driven animation, and no
// testimonial or customer-count copy. The campus data is fictional and labelled as such, so there is
// nothing to fake; these checks make sure it stays that way.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface Rule {
  name: string
  /** Which files the rule reads, by path relative to the project root (forward slashes). */
  applies: (file: string) => boolean
  /** Returns what is wrong with this line, or null. */
  check: (line: string) => string | null
}

// ---------- helpers (also tested below, so a broken pattern cannot pass silently) ----------

/** Hue (0 to 360), saturation and lightness (0 to 1) of an RGB colour given as 0 to 255. */
export function hsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const [rn, gn, bn] = [r, g, b].map((v) => v / 255)
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s, l }
}

/** Violet, indigo and purple: hues 228 to 320, clearly coloured, not almost white or black. */
export function isPurple(r: number, g: number, b: number): boolean {
  const { h, s, l } = hsl(r, g, b)
  return h >= 228 && h <= 320 && s >= 0.2 && l >= 0.08 && l <= 0.97
}

/** The first purple colour written as #rgb, #rrggbb, rgb() or hsl() on the line, or null. */
export function findPurple(line: string): string | null {
  for (const m of line.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    if (isPurple(r, g, b)) return m[0]
  }
  for (const m of line.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) {
    if (isPurple(Number(m[1]), Number(m[2]), Number(m[3]))) return m[0]
  }
  for (const m of line.matchAll(/hsla?\(\s*(\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/gi)) {
    const h = Number(m[1])
    if (h >= 228 && h <= 320 && Number(m[2]) >= 20) return m[0]
  }
  return null
}

const NAMED_PURPLE = /(purple|violet|indigo|fuchsia|magenta|lavender|lilac|orchid|amethyst)/i

/** A border-radius big enough to turn a control into a pill (100 px or more, or a viewport unit). */
export function findPillRadius(line: string): string | null {
  const m = line.match(/border-radius\s*:\s*([^;}]*)/i)
  if (!m) return null
  for (const value of m[1].matchAll(/(\d+(?:\.\d+)?)(px|rem|em|vh|vw)\b/gi)) {
    const n = Number(value[1])
    const unit = value[2].toLowerCase()
    if (unit === 'vh' || unit === 'vw') return value[0]
    if (unit === 'px' && n >= 100) return value[0]
    if ((unit === 'rem' || unit === 'em') && n >= 6) return value[0]
  }
  return null
}

/** Em dash, en dash. */
const DASH = /[–—]/u
/**
 * Emoji and glyph icons: arrows, technical symbols, geometric shapes, dingbats (ticks, crosses, stars),
 * the emoji planes, variation selectors and joiners. The middle dot and the ellipsis are not in these ranges.
 */
const GLYPH = /[←-⇿⌀-⏿■-◿☀-➿⬀-⯿︎️‍\u{1f000}-\u{1faff}]/u

const SOURCE = (file: string) => /^src\/.+\.(css|ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file)
const STYLES = (file: string) => /^src\/.+\.css$/.test(file)
const PAGES = (file: string) => SOURCE(file) || file === 'index.html' || file === 'public/favicon.svg'
const TEXT = (file: string) => PAGES(file) || file === 'README.md' || file === 'CLAUDE.md'

const RULES: Rule[] = [
  { name: 'no purple or indigo', applies: PAGES, check: (l) => findPurple(l) },
  {
    name: 'no purple or indigo colour names',
    applies: STYLES,
    check: (l) => l.match(NAMED_PURPLE)?.[0] ?? null,
  },
  { name: 'no gradients', applies: PAGES, check: (l) => l.match(/gradient\s*\(/i)?.[0] ?? null },
  { name: 'no pill-shaped controls', applies: STYLES, check: findPillRadius },
  { name: 'no em or en dashes', applies: TEXT, check: (l) => l.match(DASH)?.[0] ?? null },
  { name: 'no emoji or glyph icons (use SVG icons or words)', applies: TEXT, check: (l) => l.match(GLYPH)?.[0] ?? null },
  {
    name: 'no cursor effects or scroll-driven animation',
    applies: SOURCE,
    check: (l) =>
      l.match(/\b(mousemove|pointermove|IntersectionObserver|animation-timeline|scroll-timeline|scroll-behavior\s*:\s*smooth)\b/i)?.[0] ??
      l.match(/cursor\s*:\s*url\(/i)?.[0] ??
      null,
  },
  {
    name: 'no testimonial or customer-count copy',
    applies: SOURCE,
    check: (l) => l.match(/\b(testimonials?|trusted by|happy customers?|customers served|5-star|five-star)\b/i)?.[0] ?? null,
  },
]

// ---------- scanning ----------

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'data', 'uploads'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(path.relative(ROOT, full).split(path.sep).join('/'))
  }
  return out
}

export function scan(files: string[], read: (file: string) => string): string[] {
  const found: string[] = []
  for (const file of files) {
    const rules = RULES.filter((r) => r.applies(file))
    if (rules.length === 0) continue
    read(file)
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const rule of rules) {
          const hit = rule.check(line)
          if (hit) found.push(`${file}:${i + 1}  ${rule.name}: ${JSON.stringify(hit)}`)
        }
      })
  }
  return found
}

describe('style rules', () => {
  it('the project files follow every rule', () => {
    const files = [...walk(path.join(ROOT, 'src')), 'index.html', 'README.md', 'CLAUDE.md', 'public/favicon.svg']
    expect(files.some((f) => f.endsWith('index.css'))).toBe(true)
    expect(scan(files, (f) => readFileSync(path.join(ROOT, f), 'utf8'))).toEqual([])
  })

  it('the checks themselves catch what they are meant to catch', () => {
    const offences = (file: string, text: string) => scan([file], () => text)
    const css = 'src/x.css'
    const tsx = 'src/x.tsx'
    // purple and indigo, in every colour notation
    expect(offences(css, 'a { color: #6d28d9; }')).toHaveLength(1)
    expect(offences(css, 'a { color: #4338ca; }')).toHaveLength(1)
    expect(offences(css, 'a { color: #ede9fe; }')).toHaveLength(1)
    expect(offences(css, 'a { color: #f5f7ff; }')).toHaveLength(0) // near white: not purple
    expect(offences(css, 'a { color: rgb(124 58 237); }')).toHaveLength(1)
    expect(offences(css, 'a { color: hsl(270, 60%, 50%); }')).toHaveLength(1)
    expect(offences(css, 'a { color: rebeccapurple; }')).toHaveLength(1)
    expect(offences(css, 'a { color: purple; }')).toHaveLength(1)
    expect(offences(tsx, "const c = '#7c3aed'")).toHaveLength(1)
    // the project's own greens, creams and greys are fine
    for (const ok of ['#14654f', '#fcfaf3', '#1c2b23', '#9a4a06', '#b91c1c', '#3b4a41', '#475569', '#facc15']) {
      expect(offences(css, `a { color: ${ok}; }`)).toEqual([])
    }
    // gradients and pills
    expect(offences(css, 'a { background: linear-gradient(red, blue); }')).toHaveLength(1)
    expect(offences(css, 'a { border-radius: 999px; }')).toHaveLength(1)
    expect(offences(css, 'a { border-radius: 9999px }')).toHaveLength(1)
    expect(offences(css, 'a { border-radius: 100vh; }')).toHaveLength(1)
    expect(offences(css, 'a { border-radius: 6px; }')).toEqual([])
    expect(offences(css, 'a { border-radius: 50%; }')).toEqual([])
    // dashes, arrows, ticks, emoji
    expect(offences(tsx, 'Canteen – Hostel')).toHaveLength(1)
    expect(offences(tsx, 'Wait — what')).toHaveLength(1)
    for (const glyph of ['→', '⇅', '✓', '✕', '◷', '★', '\u{1f600}', '♿']) {
      expect(offences(tsx, `<span>${glyph}</span>`)).toHaveLength(1)
    }
    expect(offences(tsx, 'Reported 5 min ago · Library…')).toEqual([]) // middle dot and ellipsis are fine
    expect(offences('README.md', 'a — b')).toHaveLength(1)
    // cursor effects, scroll animation, testimonials
    expect(offences(tsx, "window.addEventListener('mousemove', f)")).toHaveLength(1)
    expect(offences(tsx, 'new IntersectionObserver(f)')).toHaveLength(1)
    expect(offences(css, 'html { scroll-behavior: smooth; }')).toHaveLength(1)
    expect(offences(tsx, '<p>Trusted by 10,000 students</p>')).toHaveLength(1)
    // test files and unrelated files are not scanned
    expect(offences('src/core/x.test.ts', 'a — b')).toEqual([])
    expect(offences('package.json', 'a — b')).toEqual([])
  })
})
