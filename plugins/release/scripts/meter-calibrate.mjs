#!/usr/bin/env node
// Meter calibration: how many tokens one point of the weekly meter costs.
// Reads ~/.claude/meter-ticks.log (one tab-separated row per reading:
// <iso time> <five_hour|seven_day> <from|start> <now %> <reset iso>) and the
// session transcripts, and PRINTS the figures for kit.json's
// meter.tokensPerPoint. It never writes kit.json: you paste the number.
//
// An optional marker row says which plan the readings below it belong to:
//   <iso time>\tplan\t20x
// Where both a 5x and a 20x stretch exist, the 20x/5x ratio is printed.
//
// The transcripts are streamed line by line, so gigabytes of them fit in
// node's default heap.
//
// A release's own reading is a floor, not a stretch: Skyler's tokens for its
// sessions over the meter's delta while it ran, with other sessions beside
// it, so the real figure is at least that. `--floor <label> <tokens> <points>`
// appends one to ~/.claude/meter-floors.log (Burrow V1.2: 608.5M over 8
// points), and every run prints them beside the stretches, so a release's
// reading lands here instead of in a figure edited by hand.
//
//   node meter-calibrate.mjs [--log <file>] [--projects <dir>] [--floors <file>]
//          [--floor <label> <tokens, e.g. 608.5M> <points>]
import { appendFileSync, createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { parseEntries, tallyEntries, totalTokens } from './usage.mjs'

const DEFAULT_LOG = join(homedir(), '.claude', 'meter-ticks.log')
const DEFAULT_PROJECTS = join(homedir(), '.claude', 'projects')
const DEFAULT_FLOORS = join(homedir(), '.claude', 'meter-floors.log')

// "608.5M", "608500000" or "1.2B" as tokens; NaN for anything else.
export function parseTokens(text) {
  const m = /^(\d+(?:\.\d+)?)([MB]?)$/i.exec(String(text ?? '').trim())
  if (!m) return NaN
  return Number(m[1]) * ({ m: 1e6, b: 1e9 }[m[2].toLowerCase()] ?? 1)
}

/** One floor row: `<iso time>\t<label>\t<tokens>\t<points>`; throws on a bad reading. */
export function floorRow(label, tokens, points, at = new Date()) {
  const t = parseTokens(tokens)
  const p = Number(points)
  if (!String(label ?? '').trim() || /[\t\n]/.test(label)) throw new Error('--floor needs a label without tabs, e.g. "Burrow V1.2"')
  if (!(t > 0)) throw new Error(`--floor needs tokens like 608.5M, got "${tokens}"`)
  if (!(p > 0)) throw new Error(`--floor needs the meter's delta in points, got "${points}"`)
  return `${at.toISOString()}\t${label.trim()}\t${t}\t${p}`
}

/** The floors log's rows, each with its tokens a point; unreadable rows are skipped. */
export function readFloors(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((c) => c.length === 4 && !Number.isNaN(Date.parse(c[0])) && Number(c[2]) > 0 && Number(c[3]) > 0)
    .map(([at, label, tokens, points]) => ({ at, label, tokens: Number(tokens), points: Number(points), perPoint: Number(tokens) / Number(points) }))
}

// Rows -> weekly stretches: per plan and reset time, the first and last reading.
export function weeklyStretches(logText) {
  let plan = 'plan?'
  const by = new Map()
  for (const line of logText.split('\n')) {
    const c = line.split('\t')
    if (c.length >= 3 && c[1] === 'plan') {
      plan = c[2].trim()
      continue
    }
    if (c.length < 5 || c[1] !== 'seven_day') continue
    const t = Date.parse(c[0])
    const pct = Number(c[3])
    if (!Number.isFinite(t) || !Number.isFinite(pct)) continue
    const key = `${plan}|${c[4].trim()}`
    const s = by.get(key) || { plan, reset: c[4].trim(), t0: t, p0: pct, t1: t, p1: pct }
    if (t < s.t0) {
      s.t0 = t
      s.p0 = pct
    }
    if (t >= s.t1) {
      s.t1 = t
      s.p1 = pct
    }
    by.set(key, s)
  }
  return [...by.values()].filter((s) => s.p1 > s.p0)
}

function transcriptFiles(dir, since) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name)
      if (name.isDirectory()) walk(p)
      else if (name.name.endsWith('.jsonl') && statSync(p).mtimeMs >= since) out.push(p)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

// The tokens inside each stretch, one sum per stretch. The transcripts are
// streamed a line at a time: reading every file whole ran out of memory at
// node's default 4 GB heap on 5.2 GB of transcripts (kit 1.7, a project's
// first run). Only a line that carries usage and falls in a stretch is kept,
// and only as its sum; a message.id counts once per stretch (tallyEntries' rule).
export async function tokensInStretches(files, stretches) {
  const sums = stretches.map(() => 0)
  const seen = stretches.map(() => new Set())
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line.includes('"usage"')) continue // cheap skip before a parse
      const [e] = parseEntries(line)
      if (!e?.message?.usage) continue
      const t = Date.parse(e.timestamp)
      stretches.forEach((s, i) => {
        if (!(t > s.t0 && t <= s.t1)) return
        const id = e.message.id
        if (id) {
          if (seen[i].has(id)) return
          seen[i].add(id)
        }
        for (const b of tallyEntries([e]).values()) sums[i] += totalTokens(b)
      })
    }
  }
  return sums
}

const fmtM = (t) => `${(t / 1_000_000).toFixed(1)}M`

async function main() {
  const argv = process.argv.slice(2)
  const opt = (flag, dflt) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt)
  const log = opt('--log', DEFAULT_LOG)
  const projects = opt('--projects', DEFAULT_PROJECTS)
  const floorsFile = opt('--floors', DEFAULT_FLOORS)

  if (argv.includes('--floor')) {
    const i = argv.indexOf('--floor')
    appendFileSync(floorsFile, `${floorRow(argv[i + 1], argv[i + 2], argv[i + 3])}\n`)
    console.log(`Floor recorded in ${floorsFile}.`)
  }
  const floors = existsSync(floorsFile) ? readFloors(readFileSync(floorsFile, 'utf8')) : []
  const highest = floors.reduce((top, f) => (f.perPoint > (top?.perPoint ?? 0) ? f : top), null)
  if (floors.length) {
    console.log('Release floors (Skyler over the meter delta, other sessions beside it: the real figure is at least this):')
    for (const f of floors) console.log(`  ${f.label}: ${fmtM(f.perPoint)} a point (${fmtM(f.tokens)} over ${f.points} points, ${f.at.slice(0, 10)})`)
    console.log('')
  }

  if (!existsSync(log)) {
    console.log(`No meter log at ${log}.`)
    console.log('Start one: a hook or routine that appends a tab-separated row each time the usage')
    console.log('meter moves: <iso time> <five_hour|seven_day> <previous|start> <percent now> <reset iso>.')
    console.log('Let it run for a few days of normal work, then run this again.')
    return
  }
  const stretches = weeklyStretches(readFileSync(log, 'utf8'))
  if (stretches.length === 0) {
    console.log('The log has no weekly stretch where the meter moved yet: keep it running.')
    return
  }
  const since = Math.min(...stretches.map((s) => s.t0))
  const sums = await tokensInStretches(transcriptFiles(projects, since), stretches)

  const plans = new Map()
  for (const [i, s] of stretches.entries()) {
    const tokens = sums[i]
    const p = plans.get(s.plan) || { points: 0, tokens: 0 }
    p.points += s.p1 - s.p0
    p.tokens += tokens
    plans.set(s.plan, p)
    console.log(`week to ${s.reset.slice(0, 16)}Z (${s.plan}): ${s.p0} -> ${s.p1} points, ${fmtM(tokens)} tokens`)
  }
  const perPoint = new Map()
  for (const [plan, p] of plans) {
    const pp = p.tokens / p.points
    perPoint.set(plan, pp)
    console.log(`${plan}: ${fmtM(pp)} tokens per point, a week is about ${fmtM(pp * 100)} (${p.points} points measured)`)
  }
  if (perPoint.has('20x') && perPoint.has('5x')) {
    console.log(`20x/5x ratio: ${(perPoint.get('20x') / perPoint.get('5x')).toFixed(2)}`)
  }
  const first = [...perPoint.values()][0]
  // A stretch under a release's floor missed transcripts (another machine's
  // sessions, a cloud one): the floor is the better figure then.
  const pick = highest && highest.perPoint > first ? highest.perPoint : first
  if (pick !== first) console.log(`\nThe stretches give less than ${highest.label}'s floor (${fmtM(highest.perPoint)}): transcripts are missing from them (another machine, a cloud session), so the floor stands.`)
  console.log(`\nFor kit.json (paste it yourself; this script never writes it):`)
  console.log(`  "meter": { "tokensPerPoint": { "opus": ${Math.round(pick)} } }`)
  console.log('All models count together here: a mixed week gives one blended figure.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
