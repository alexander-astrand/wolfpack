#!/usr/bin/env node
// Deals the design directions a `mosbius-designs` order draws: two for a layout, three for a drawn
// thing. Kit 1.9 (Alexander's pick, 2 Nov 2026: "Dealt design directions"; the idea from
// taste-skill, MIT, no text taken): a model asked for two options tends to draw the category
// default twice, so a script picks the directions and the designer chooses how to draw them.
//
//   node <design>/scripts/deal.mjs [--project <dir>] [--kind layout|drawn] [--dry]
//                                  [--library <library.md>] [--log-dir <dir>] [--template <file>]
//                                  [--now <YYYY-MM-DD>] [--seed <n>]
//
// --project   the project whose `.claude/directions.md` is read (default the working folder).
//             With none, the kit's starter in `design/directions-template.md` is dealt and the
//             output says so (Alexander, 3 Nov: every mosbius order deals).
// --kind      layout deals two, drawn deals three (default layout).
// --library   the design library whose `Pick` and `Score` cells weight the deal (default
//             ~/.claude/plans/design/library.md); read with leans.mjs's row reader. Missing: equal
//             weights, with a note.
// --log-dir   where `<project>/deals.log` lives (default ~/.claude/plans/design). One line per
//             deal; the same set is never dealt twice in a row for one kind, and a deal older
//             than 30 days is forgotten.
// --dry       deal and print, but write no log line.
// --now, --seed   a fixed day and a fixed random seed, for tests and repeatable runs.
//
// Prints the deal as JSON, then one `Brief:` line for the order.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_LIBRARY, parseLibrary } from './leans.mjs'

export const DEFAULT_LOG_DIR = join(homedir(), '.claude', 'plans', 'design')
export const DEFAULT_TEMPLATE = join(dirname(dirname(fileURLToPath(import.meta.url))), 'directions-template.md')
export const COUNTS = { layout: 2, drawn: 3 }
// A deal this old no longer counts as "the last one": a month without a design round is a fresh start.
export const LOG_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

/**
 * Every `### Name` entry and its `- Key: value` lines, anywhere in the file, so a list of one or
 * of twenty parses the same, and an extra line (C3's `Why`) rides along. Headings inside a code
 * fence (the template's format block) and entries with no fields are skipped; a repeated name
 * keeps its first entry.
 */
export function parseDirections(text) {
  const out = []
  let cur = null
  let fenced = false
  for (const line of String(text ?? '').split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const h = line.match(/^###\s+(.+?)\s*$/)
    if (h) {
      cur = { name: h[1] }
      out.push(cur)
      continue
    }
    if (/^#{1,2}\s/.test(line)) {
      cur = null
      continue
    }
    const f = cur && line.match(/^\s*-\s+([A-Za-z][\w ]*?):\s*(.+?)\s*$/)
    if (f) cur[f[1].toLowerCase()] = f[2]
  }
  const seen = new Set()
  return out.filter((d) => {
    const key = d.name.toLowerCase()
    if (Object.keys(d).length < 2 || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One weight per direction from the library rows: 1, plus 1 for each row whose Pick names it,
 * plus 1 more when that row's lean won (he picked it and heisenberg had leaned to it). Never 0,
 * so a direction he hasn't picked yet still gets dealt.
 */
export function weigh(directions, rows = []) {
  return directions.map((d) => {
    const re = new RegExp(`(^|[^\\w])${escape(d.name)}($|[^\\w])`, 'i')
    let weight = 1
    for (const r of rows) {
      if (!re.test(r.pick ?? '')) continue
      weight += r.kind === 'won' ? 2 : 1
    }
    return { ...d, weight }
  })
}

/** A small seeded generator (mulberry32), so `--seed` gives the same deal every run. */
export function seeded(seed) {
  let a = Number(seed) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const setKey = (names) => names.map((n) => n.toLowerCase()).sort().join(' | ')

/** `count` directions drawn by weight without putting any back. */
function draw(weighted, count, rand) {
  const pool = [...weighted]
  const out = []
  while (out.length < count && pool.length) {
    const total = pool.reduce((s, d) => s + d.weight, 0)
    let r = rand() * total
    let i = 0
    while (i < pool.length - 1 && r >= pool[i].weight) r -= pool[i++].weight
    out.push(pool.splice(i, 1)[0])
  }
  return out
}

/**
 * The deal: `count` directions by weight, never the set in `last` (a sorted-name key) when
 * another set exists. After a few unlucky draws the lightest dealt direction is swapped for the
 * heaviest one left out, so a lopsided weighting can't force the repeat.
 */
export function dealSet(weighted, count, { last = null, rand = Math.random } = {}) {
  const n = Math.min(count, weighted.length)
  const canAvoid = last && weighted.length > n
  let hand = draw(weighted, n, rand)
  for (let i = 0; canAvoid && setKey(hand.map((d) => d.name)) === last && i < 20; i++) hand = draw(weighted, n, rand)
  if (canAvoid && setKey(hand.map((d) => d.name)) === last) {
    const lightest = hand.reduce((a, b) => (b.weight < a.weight ? b : a))
    const outside = weighted.filter((d) => !hand.includes(d)).reduce((a, b) => (b.weight > a.weight ? b : a))
    hand = hand.map((d) => (d === lightest ? outside : d))
  }
  return hand
}

/** The last deal of this kind in the log within LOG_DAYS of `now`, as a sorted-name key. */
export function lastDeal(logText, kind, now) {
  const since = Date.parse(now) - LOG_DAYS * DAY
  let last = null
  for (const line of String(logText ?? '').split('\n')) {
    const [date, k, names] = line.split('\t')
    if (!names || k !== kind) continue
    const t = Date.parse(date)
    if (Number.isNaN(t) || t < since) continue
    last = setKey(names.split(' | '))
  }
  return last
}

export const logLine = (now, kind, names) => `${now}\t${kind}\t${names.join(' | ')}\n`

export function briefLine({ kind, dealt, starter }) {
  const list = dealt.map((d) => `**${d.name}**${d.feel ? ` (${d.feel.replace(/\.$/, '')})` : ''}`).join('; ')
  const from = starter ? "the kit's starter" : 'directions.md'
  return `Brief: dealt ${dealt.length} direction${dealt.length === 1 ? '' : 's'} for a ${kind} from ${from}: ${list}. Draw one option per direction, named by it.`
}

function parseArgs(argv) {
  const o = {
    project: process.cwd(),
    kind: 'layout',
    library: DEFAULT_LIBRARY,
    logDir: DEFAULT_LOG_DIR,
    template: DEFAULT_TEMPLATE,
    now: new Date().toISOString().slice(0, 10),
    seed: null,
    dry: false,
  }
  const keys = { '--project': 'project', '--kind': 'kind', '--library': 'library', '--log-dir': 'logDir', '--template': 'template', '--now': 'now', '--seed': 'seed' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry') o.dry = true
    else if (keys[a]) o[keys[a]] = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!COUNTS[o.kind]) throw new Error(`--kind is layout or drawn, not ${o.kind}`)
  return o
}

/** The deal as an object; writes the log line unless `dry`. */
export function deal(argv) {
  const o = parseArgs(argv)
  const project = resolve(o.project)
  const name = basename(project)
  const notes = []
  const own = join(project, '.claude', 'directions.md')
  const starter = !existsSync(own)
  const source = starter ? o.template : own
  if (starter) notes.push(`${name} has no .claude/directions.md, so this deal is from the kit's starter (${o.template}).`)
  const directions = parseDirections(readFileSync(source, 'utf8'))
  if (!directions.length) throw new Error(`no directions in ${source}`)

  let rows = []
  if (existsSync(o.library)) rows = parseLibrary(readFileSync(o.library, 'utf8'))
  else notes.push(`no library at ${o.library}, so every direction weighs the same.`)

  const count = COUNTS[o.kind]
  if (directions.length < count) notes.push(`only ${directions.length} of the ${count} directions a ${o.kind} wants are in ${source}, so all of them are dealt.`)

  const log = join(o.logDir, name, 'deals.log')
  const last = lastDeal(existsSync(log) ? readFileSync(log, 'utf8') : '', o.kind, o.now)
  const rand = o.seed == null ? Math.random : seeded(o.seed)
  const dealt = dealSet(weigh(directions, rows), count, { last, rand })

  if (!o.dry) {
    mkdirSync(dirname(log), { recursive: true })
    appendFileSync(log, logLine(o.now, o.kind, dealt.map((d) => d.name)))
  }
  const result = { project: name, kind: o.kind, source, starter, dealt, log: o.dry ? null : log, notes }
  return { ...result, brief: briefLine(result) }
}

export function run(argv) {
  const { brief, ...result } = deal(argv)
  return `${JSON.stringify(result, null, 2)}\n${brief}`
}

// Node runs the real file, so a spaced or symlinked path compares as its real URL.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    console.log(run(process.argv.slice(2)))
  } catch (err) {
    console.error(`deal.mjs: ${err.message}`)
    process.exit(1)
  }
}
