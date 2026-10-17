#!/usr/bin/env node
// The per-role table `/jedi-council` reads for "which roles earned their keep":
// per role (the navigator, then each agent by name) its runs, tokens, tool
// calls and active minutes over the window, across one or more projects.
// The kit 1.4 council built this from a scratch script; `r2-d2` has no shell,
// so the navigator runs this one (J2). Built on usage.mjs's parser and
// council-speed's de-duplication, so it matches Skyler and the speed table.
//
// Usage: node council-roles.mjs --since <YYYY-MM-DD> [--dir <transcripts>]…
// Without --dir the transcripts are this project's (derived from the cwd).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentName, projectDir, readEntries, timelineRow } from './usage.mjs'
import { byBirth, dropSeen } from './council-speed.mjs'

const HELP = `Usage: node council-roles.mjs --since <YYYY-MM-DD> [--dir <transcripts>]…
Prints a markdown table per role: runs, tokens, share, tool calls, active minutes, models.`

export function parseArgs(argv) {
  const opts = { dirs: [], since: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') opts.help = true
    else if (argv[i] === '--dir') opts.dirs.push(argv[++i])
    else if (argv[i] === '--since') opts.since = argv[++i]
  }
  return opts
}

function readMeta(subDir, file) {
  try {
    return JSON.parse(readFileSync(join(subDir, file.replace(/\.jsonl$/, '.meta.json')), 'utf8'))
  } catch {
    return {}
  }
}

// usage.mjs's agentName knows only the agents with a Hank budget; a generic
// spawn whose description starts "<name>:" is that role here too (r2-d2,
// mace-windu and the rest are not on its list).
export function roleOf(meta) {
  const name = agentName(meta)
  if (name && !/^(general-purpose|claude)$/.test(name)) return name.replace(/^[\w-]+:/, '')
  return /^\s*([a-z0-9-]+)\s*:/.exec(meta.description || '')?.[1] || name || 'unnamed'
}

// Every session in the dirs whose transcript was written on or after `from`,
// oldest first, one `seen` set across all of them (a fork counts once).
export function roleTotals(dirs, from) {
  const roles = new Map()
  const seen = new Set()
  const add = (role, row) => {
    if (!row.tokens && !row.calls) return // a copy with nothing of its own
    const r = roles.get(role) || { role, runs: 0, tokens: 0, calls: 0, minutes: 0, models: new Set() }
    r.runs += 1
    r.tokens += row.tokens
    r.calls += row.calls
    r.minutes += row.minutes
    if (row.model !== '?') r.models.add(row.model)
    roles.set(role, r)
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && statSync(join(dir, f)).mtimeMs >= from)
    for (const f of byBirth(dir, files)) {
      const id = f.slice(0, -'.jsonl'.length)
      add('navigator', timelineRow(dropSeen(readEntries(join(dir, f)), seen), 'navigator', 'navigator', id))
      const subDir = join(dir, id, 'subagents')
      const subs = existsSync(subDir) ? readdirSync(subDir).filter((x) => x.endsWith('.jsonl')) : []
      for (const s of subs) {
        const meta = readMeta(subDir, s)
        const role = roleOf(meta)
        add(role, timelineRow(dropSeen(readEntries(join(subDir, s)), seen), s, role, id))
      }
    }
  }
  return [...roles.values()].sort((a, b) => b.tokens - a.tokens)
}

const fmtM = (n) => `${(n / 1e6).toFixed(1)}M`

export function tableOf(rows) {
  const total = rows.reduce((s, r) => s + r.tokens, 0)
  const out = ['| Role | Runs | Tokens | Share | Calls | Active min | Models |', '|---|---|---|---|---|---|---|']
  for (const r of rows) {
    const share = total ? `${Math.round((r.tokens / total) * 100)}%` : '0%'
    out.push(`| ${r.role} | ${r.runs} | ${fmtM(r.tokens)} | ${share} | ${r.calls} | ${r.minutes} | ${[...r.models].sort().join('/') || '?'} |`)
  }
  out.push(`| **Total** | ${rows.reduce((s, r) => s + r.runs, 0)} | ${fmtM(total)} | 100% | ${rows.reduce((s, r) => s + r.calls, 0)} | ${rows.reduce((s, r) => s + r.minutes, 0)} | |`)
  return out.join('\n')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const from = Date.parse(opts.since ?? '')
  if (opts.help || Number.isNaN(from)) {
    console.log(HELP)
    process.exit(opts.help ? 0 : 1)
  }
  const dirs = opts.dirs.length ? opts.dirs : [projectDir(null)]
  console.log(tableOf(roleTotals(dirs, from)))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
