#!/usr/bin/env node
// The week receipt: every project's tokens and its slice of the weekly meter,
// for all transcript folders in one call. `/previously-on` runs in each
// project on Sunday and each run used to list every folder and call Skyler
// once per folder (2 calls x 20 to 30 folders, the same all-project tally
// repeated once per project: jedi-council 1.6.1 L1, core Feature 5). Now the
// first run of the week writes the receipt and the others read it.
//
// Usage: node week-receipt.mjs [--week <yyyy-Www>] [--json] [--fresh]
//          [--projects <dir>] [--cache <dir>]
// --week: the ISO week (default this one), Monday 00:00 local time on.
// --json: the receipt as JSON instead of the Markdown table.
// --fresh: recount even when this week's receipt is under two hours old.
// --projects: the transcript folders' home (default ~/.claude/projects).
// --cache: where the receipt is kept (default ~/.claude/week-receipt), one
//   <yyyy-Www>.json per week.
//
// Counting is Skyler's (the release plugin's usage.mjs): its readers, one
// `seen` set so a forked copy counts once, and tokensPerPoint() per model
// family for the meter column, so the receipt and a PR's Usage line agree.
// Only messages stamped inside the week count, so a session that started
// before Monday adds only its own week's part.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// The kit ships its plugins side by side (`<kit>/plugins/<name>`), so the
// release plugin's scripts sit two folders up from here.
import { readEntries, readKit, tallyEntries, tokensPerPoint, totalTokens } from '../../release/scripts/usage.mjs'

const DAY = 86_400_000
const CACHE_AGE = 2 * 3_600_000

// Monday 00:00 local of ISO week `yyyy-Www`, and the next Monday.
export function weekRange(week) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(week || '')
  if (!m) throw new Error(`--week wants yyyy-Www, got "${week}"`)
  const jan4 = new Date(Number(m[1]), 0, 4)
  const monday1 = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7))
  const start = new Date(monday1.getFullYear(), monday1.getMonth(), monday1.getDate() + (Number(m[2]) - 1) * 7)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  return { start: start.getTime(), end: end.getTime() }
}

// The ISO week a date falls in, as yyyy-Www.
export function isoWeek(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)) // that week's Thursday
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const n = 1 + Math.round(((d - jan4) / DAY - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(n).padStart(2, '0')}`
}

// The project a session's cwd belongs to: a worktree under .claude/worktrees
// or a lane in <Project>-lanes/ counts to its main checkout, named by that
// checkout's kit.json project.name when it has one, else its folder's name.
export function projectOfCwd(cwd) {
  let root = cwd.replace(/\/\.claude\/worktrees\/.*$/, '')
  const lane = /^(.*)-lanes\/[^/]+/.exec(root)
  if (lane) root = lane[1]
  return readKit(root)?.project?.name || basename(root)
}

// A folder with no cwd in any transcript is named from its own name, as
// `/previously-on` did by hand: the part after -Desktop-, else the last part.
export function projectOfFolder(folder) {
  const name = folder.replace(/--claude-worktrees-.*$/, '').replace(/-lanes-.*$/, '')
  const desk = /-Desktop-(.+)$/.exec(name)
  return desk ? desk[1] : name.split('-').filter(Boolean).pop() || name
}

const family = (model) => (/(haiku|sonnet|opus|fable)/i.exec(model || '') || ['opus'])[0].toLowerCase()
const recent = (file, since) => {
  try {
    return statSync(file).mtimeMs >= since
  } catch {
    return false
  }
}

// Every transcript file touched since `start` in one folder: the sessions'
// own files and their subagents'.
function weekFiles(dir, start) {
  const files = []
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return files
  }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    const main = join(dir, n)
    if (recent(main, start)) files.push(main)
    const sub = join(dir, n.slice(0, -'.jsonl'.length), 'subagents')
    let subs = []
    try {
      subs = readdirSync(sub)
    } catch {
      continue
    }
    for (const s of subs) if (s.endsWith('.jsonl') && recent(join(sub, s), start)) files.push(join(sub, s))
  }
  return files
}

// `range` ({ start, end } in ms) counts another window than the ISO week,
// such as the meter's own week from its Saturday reset (Dev HQ's shares);
// `week` then only names it and its cache file.
export function receipt({ week = isoWeek(), range = null, projectsDir = join(homedir(), '.claude', 'projects'), kit = readKit() } = {}) {
  const { start, end } = range || weekRange(week)
  const seen = new Set()
  const by = new Map() // project -> { tokens, points, folders: Set }
  let folders = []
  try {
    folders = readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (e) {
    throw new Error(`Can't read ${projectsDir}: ${e.message}`)
  }
  for (const folder of folders.sort()) {
    for (const file of weekFiles(join(projectsDir, folder), start)) {
      const entries = readEntries(file, seen)
      const cwd = entries.find((e) => typeof e?.cwd === 'string')?.cwd
      const inWeek = entries.filter((e) => {
        const t = Date.parse(e?.timestamp)
        return Number.isFinite(t) && t >= start && t < end
      })
      const tally = tallyEntries(inWeek)
      if (!tally.size) continue
      const name = cwd ? projectOfCwd(cwd) : projectOfFolder(folder)
      const p = by.get(name) || { tokens: 0, points: 0, folders: new Set() }
      for (const [model, b] of tally) {
        const t = totalTokens(b)
        p.tokens += t
        p.points += t / tokensPerPoint(kit, family(model))
      }
      p.folders.add(folder)
      by.set(name, p)
    }
  }
  const allPoints = [...by.values()].reduce((s, p) => s + p.points, 0)
  const projects = [...by.entries()]
    .map(([name, p]) => ({ name, tokens: p.tokens, share: allPoints > 0 ? p.points / allPoints : 0, meterPct: p.points, folders: [...p.folders] }))
    .sort((a, b) => b.meterPct - a.meterPct)
  return {
    week,
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    written: new Date().toISOString(),
    tokensPerPoint: tokensPerPoint(kit),
    totalTokens: projects.reduce((s, p) => s + p.tokens, 0),
    meterPct: allPoints,
    projects,
  }
}

const fmtM = (t) => `${(t / 1e6).toFixed(1)}M`
const pct = (x) => (x > 0 && x < 0.5 ? '<1%' : `${Math.round(x)}%`)

export function markdown(r) {
  const rows = ['| Project | Tokens | Share | Of the meter |', '|---|---|---|---|']
  for (const p of r.projects) rows.push(`| ${p.name} | ${fmtM(p.tokens)} | ${pct(p.share * 100)} | ${pct(p.meterPct)} |`)
  rows.push(`| All | ${fmtM(r.totalTokens)} | 100% | ${pct(r.meterPct)} |`)
  if (!r.projects.length) rows.push('', 'No transcripts this week.')
  rows.push('', 'Estimate: only messages inside the week count; each model is weighed by its meter figure (usage.mjs tokensPerPoint), so the slices can differ from get_usage.')
  return rows.join('\n')
}

// This week's receipt from the cache when it's under two hours old, else
// counted and written there, so the Sunday runs in each project share one.
export function cachedReceipt({ week = isoWeek(), cacheDir = join(homedir(), '.claude', 'week-receipt'), fresh = false, ...rest } = {}) {
  const file = join(cacheDir, `${week}.json`)
  if (!fresh && existsSync(file)) {
    try {
      const r = JSON.parse(readFileSync(file, 'utf8'))
      if (Date.now() - Date.parse(r.written) < CACHE_AGE) return { ...r, cached: file }
    } catch {
      // unreadable: count again
    }
  }
  const r = receipt({ week, ...rest })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`)
  return { ...r, cached: null }
}

// The command line's receipt. `--projects` counts another folder, so it
// neither reads nor writes the shared cache: the Sunday runs would get its
// numbers, or it theirs (kit 1.7 review).
export function cliReceipt(opts) {
  if (opts.projectsDir) {
    const { cacheDir, fresh, ...rest } = opts
    return { ...receipt(rest), cached: null }
  }
  return cachedReceipt(opts)
}

function parseArgs(argv) {
  const o = { json: false, fresh: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') o.json = true
    else if (a === '--fresh') o.fresh = true
    else if (a === '--week') o.week = argv[++i]
    else if (a === '--projects') o.projectsDir = argv[++i]
    else if (a === '--cache') o.cacheDir = argv[++i]
    else throw new Error(`Unknown argument "${a}". Usage: node week-receipt.mjs [--week <yyyy-Www>] [--json] [--fresh] [--projects <dir>] [--cache <dir>]`)
  }
  return o
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { json, ...opts } = parseArgs(process.argv.slice(2))
    for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k]
    const r = cliReceipt(opts)
    console.log(json ? JSON.stringify(r, null, 2) : markdown(r))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
