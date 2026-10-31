#!/usr/bin/env node
// The three likeliest repeat sendbacks for a diff's pages, from both taste files. Kit 1.8 (kit 1.7.1
// council Feature 9, design lens Feature 2): "the worst sendback is a repeat", and the repeat index
// (`Solved on: <page>`) was a grep every reader ran by hand, or not at all. This is that grep, scored.
//
//   node <design>/scripts/taste-repeats.mjs <page> [<page>...] [--top <n>] [--kit <taste.md>] [--project <taste.md>]
//
// Reads the kit's taste (<design>/taste.md, the general rules) and the project's (.claude/taste.md
// under the current folder), takes every rule line ("- ..."), and scores it for the pages given:
//   +3  it carries `Solved on: <page>` for a page outside the list: a pattern one page got right
//       that these pages may not have copied (the commonest repeat, kit 1.6.1 council M6)
//   +2  for each repeat word (again, repeat, identical, still, "did we not learn", and second or third
//       only before time, round, sendback and the like), at most two; a field label (`Repeat:`) is not one
//   +2  it names one of the pages outside its tag: that page was sent back for it before
//   +1  it is in the project's file, the more specific of the two
// A rule needs a tag or a repeat word to count. Prints the top three (or --top n) as file:line, the
// score's reasons and the rule, so tomas-svensson and the builders check those first. Exit 0 always.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// "second" and "third" count only in a repeat phrase ("a second time", "third
// sendback"): alone they are mostly ordinals, and "second bar" was a false hit
// that put the council's 16 repeat lines at 21.
export const REPEAT_WORDS = /\b(?:(second|third)(?=[\s-]+(?:time|round|sendback|send-back|pass|try|attempt|report|ask)s?\b)|again|repeat(?:ed|s)?|identical|still)\b|did we not learn/gi
// A field label is a name, not a repeat: `Repeat:` or **Repeat:** (capital,
// then a colon), or the word alone in quotes ("Repeat", `Repeat`): a form's
// Repeat field was the other false hit. Cut before matching. A quote with more
// in it ("we did this again") still counts: that is Alexander's sendback.
const WORD = 'repeat(?:ed|s)?|second|third|again|identical|still'
const LABEL_COLON = /\*{0,2}\b(?:Repeat(?:ed|s)?|Second|Third|Again|Identical|Still):\*{0,2}/g
const LABEL_QUOTED = new RegExp(`(["'\`])(?:${WORD})\\1`, 'gi')
export const repeatWords = (line) => [
  ...new Set((line.replace(LABEL_COLON, ' ').replace(LABEL_QUOTED, ' ').match(REPEAT_WORDS) ?? []).map((w) => w.toLowerCase())),
]

// A page name as words: "/trips/:id" and "Trips page" both become "trips".
export const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[/:_-]+/g, ' ')
    .replace(/\b(page|the|id)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function score(line, pages, { project = false } = {}) {
  if (!/^\s*- /.test(line)) return null
  const wanted = pages.map(norm).filter(Boolean)
  const reasons = []
  let n = 0
  const tag = line.match(/Solved on: ([^.(]+)/)
  const solved = tag ? norm(tag[1]) : null
  if (solved && !wanted.some((p) => solved.includes(p) || p.includes(solved))) {
    n += 3
    reasons.push(`solved on ${tag[1].trim()}`)
  }
  const words = repeatWords(line).slice(0, 2)
  if (!tag && !words.length) return null
  if (words.length) {
    n += 2 * words.length
    reasons.push(`says ${words.join(', ')}`)
  }
  const body = norm(tag ? line.replace(tag[0], '') : line)
  // Whole words, so a page called "a" or "map" doesn't match inside "a map" or "maple".
  const named = wanted.filter((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body))
  if (named.length) {
    n += 2
    reasons.push(`names ${named.join(', ')}`)
  }
  if (project) n += 1
  return n > 0 ? { score: n, reasons } : null
}

export function repeats(files, pages, top = 3) {
  const hits = []
  for (const { path, text, project } of files) {
    for (const [i, line] of text.split('\n').entries()) {
      const s = score(line, pages, { project })
      if (s) hits.push({ at: `${path}:${i + 1}`, ...s, rule: line.replace(/^\s*- /, '').trim() })
    }
  }
  // Highest score first; the sort is stable, so a tie keeps file order (the kit's, then the project's).
  return hits.sort((a, b) => b.score - a.score).slice(0, top)
}

export function format(hits) {
  if (!hits.length) return 'No tagged or repeat rule matched: the taste files carry no `Solved on:` tags yet, or none touch these pages.'
  return hits.map((h, i) => `${i + 1}. ${h.at} (${h.score}: ${h.reasons.join('; ')})\n   ${h.rule.length > 220 ? `${h.rule.slice(0, 220)}...` : h.rule}`).join('\n')
}

export function parseArgs(argv, cwd = process.cwd()) {
  const o = { pages: [], top: 3, kit: resolve(here, '..', 'taste.md'), project: join(cwd, '.claude', 'taste.md') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--top') o.top = Number(argv[++i])
    else if (a === '--kit') o.kit = resolve(argv[++i])
    else if (a === '--project') o.project = resolve(argv[++i])
    else if (a === '--help' || a === '-h') o.help = true
    else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`)
    else o.pages.push(a)
  }
  if (!Number.isInteger(o.top) || o.top < 1) throw new Error('--top is not a positive whole number')
  return o
}

export function run(o) {
  const files = []
  for (const [path, project] of [[o.kit, false], [o.project, true]]) if (existsSync(path)) files.push({ path, text: readFileSync(path, 'utf8'), project })
  return format(repeats(files, o.pages, o.top))
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let o
  try {
    o = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  if (o.help || !o.pages.length) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n'))
    process.exit(o.help ? 0 : 2)
  }
  console.log(run(o))
}
