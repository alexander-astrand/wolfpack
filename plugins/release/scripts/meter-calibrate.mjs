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
//   node meter-calibrate.mjs [--log <file>] [--projects <dir>]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEntries, tallyEntries, totalTokens } from './usage.mjs'

const DEFAULT_LOG = join(homedir(), '.claude', 'meter-ticks.log')
const DEFAULT_PROJECTS = join(homedir(), '.claude', 'projects')

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

function tokensBetween(entriesByFile, t0, t1) {
  const picked = []
  for (const entries of entriesByFile) {
    for (const e of entries) {
      const t = Date.parse(e.timestamp)
      if (t > t0 && t <= t1) picked.push(e)
    }
  }
  let sum = 0
  for (const b of tallyEntries(picked).values()) sum += totalTokens(b)
  return sum
}

const fmtM = (t) => `${(t / 1_000_000).toFixed(1)}M`

function main() {
  const argv = process.argv.slice(2)
  const opt = (flag, dflt) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt)
  const log = opt('--log', DEFAULT_LOG)
  const projects = opt('--projects', DEFAULT_PROJECTS)

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
  const entriesByFile = transcriptFiles(projects, since).map((f) => parseEntries(readFileSync(f, 'utf8')))

  const plans = new Map()
  for (const s of stretches) {
    const tokens = tokensBetween(entriesByFile, s.t0, s.t1)
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
  console.log(`\nFor kit.json (paste it yourself; this script never writes it):`)
  console.log(`  "meter": { "tokensPerPoint": { "opus": ${Math.round(first)} } }`)
  console.log('All models count together here: a mixed week gives one blended figure.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
