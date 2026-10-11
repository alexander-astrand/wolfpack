#!/usr/bin/env node
// The speed table `/jedi-council` reads: one row per session (the command it
// started with, wall-clock, agent-minutes, calls, tokens). A script because the
// scout that used to build it has no shell (the 3.3.2 council ran it by hand in
// one loop). It reuses usage.mjs's parser, so the numbers match Skyler's.
//
// Usage: node council-speed.mjs [--dir <transcripts>] <session-id>…
//        node council-speed.mjs [--dir <transcripts>] --since <YYYY-MM-DD>
// Without --dir the transcripts are this project's (derived from the cwd).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hhmm, projectDir, readEntries, resolveSession, timelineRow } from './usage.mjs'

const HELP = `Usage: node council-speed.mjs [--dir <transcripts>] <session-id>…
       node council-speed.mjs [--dir <transcripts>] --since <YYYY-MM-DD>
Prints a markdown table: session, command, wall-clock, agent-minutes, calls, tokens.`

export function parseArgs(argv) {
  const opts = { dir: null, since: null, ids: [], help: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') opts.help = true
    else if (argv[i] === '--dir') opts.dir = argv[++i]
    else if (argv[i] === '--since') opts.since = argv[++i]
    else opts.ids.push(argv[i])
  }
  return opts
}

// The slash command a session started with: Claude Code writes it into the
// first user message as <command-name>/x</command-name>; a typed "/x" works too.
export function startCommand(entries) {
  for (const e of entries.slice(0, 40)) {
    if (e.type !== 'user') continue
    const c = e.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('\n') : ''
    const m = /<command-name>\s*(\/?[\w:-]+)\s*<\/command-name>/.exec(text) || /^\s*(\/[\w:-]+)/.exec(text)
    if (m) return m[1].startsWith('/') ? m[1] : `/${m[1]}`
  }
  return '(none)'
}

const fmtM = (n) => `${(n / 1e6).toFixed(1)}M`
const fmtHm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`

// One row for a session: its main transcript plus every subagent's.
export function sessionRow(baseDir, idPrefix) {
  const { id, mainFile, subDir, subFiles } = resolveSession(baseDir, idPrefix)
  const main = readEntries(mainFile)
  const rows = [timelineRow(main, 'navigator', 'navigator', id)]
  for (const f of subFiles) rows.push(timelineRow(readEntries(join(subDir, f)), f, f, id))
  const timed = rows.filter((r) => r.start)
  const first = timed.length ? Math.min(...timed.map((r) => r.start)) : 0
  const last = timed.length ? Math.max(...timed.map((r) => r.end)) : 0
  return {
    id,
    command: startCommand(main),
    first,
    wall: Math.round((last - first) / 60_000),
    agentMinutes: rows.reduce((s, r) => s + r.minutes, 0),
    calls: rows.reduce((s, r) => s + r.calls, 0),
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
  }
}

export function tableOf(sessions) {
  const out = [
    '| Session | Command | Start | Wall-clock | Agent-min | Calls | Tokens |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const s of sessions) {
    out.push(
      `| ${s.id.slice(0, 8)} | ${s.command} | ${s.first ? hhmm(s.first) : '–'} | ${fmtHm(s.wall)} | ${s.agentMinutes} | ${s.calls} | ${fmtM(s.tokens)} |`,
    )
  }
  return out.join('\n')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || (!opts.since && opts.ids.length === 0)) {
    console.log(HELP)
    process.exit(opts.help ? 0 : 1)
  }
  const base = projectDir(opts.dir)
  let ids = opts.ids
  if (opts.since) {
    const from = Date.parse(opts.since)
    if (Number.isNaN(from)) {
      console.error(`--since needs a date like 2026-10-01, got "${opts.since}"`)
      process.exit(1)
    }
    // A transcript's file time is its last write; a session that ended after
    // the date may have started before it, which the table's Start column shows.
    ids = readdirSync(base)
      .filter((f) => f.endsWith('.jsonl') && statSync(join(base, f)).mtimeMs >= from)
      .map((f) => f.slice(0, -'.jsonl'.length))
  }
  const sessions = ids.map((id) => sessionRow(base, id)).sort((a, b) => a.first - b.first)
  console.log(tableOf(sessions))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
