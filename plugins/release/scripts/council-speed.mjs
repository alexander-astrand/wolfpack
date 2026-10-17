#!/usr/bin/env node
// The speed table `/jedi-council` reads: one row per session (the command it
// started with, wall-clock, agent-minutes, calls, tokens). A script because the
// scout that used to build it has no shell (the 3.3.2 council ran it by hand in
// one loop). It reuses usage.mjs's parser, so the numbers match Skyler's, and
// counts each message.id once across every file it reads (dropSeen).
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

// A forked or resumed session starts its transcript with a byte-identical copy
// of its parent's lines, so summing files counted one session's work two or
// three times (J4, kit 1.4 council). `seen` holds every message.id from the
// files read before this one; their lines are dropped. Ids are added only after
// the file, because one message spans several lines (one per content block)
// and usage.mjs's tally and call count need all of them. A line with no
// message id (a prompt, a tool result) is keyed by its own uuid.
export function dropSeen(entries, seen) {
  if (!seen) return entries
  const mine = new Set()
  const out = entries.filter((e) => {
    const id = e?.message?.id ?? e?.uuid
    if (!id) return true
    if (seen.has(id)) return false
    mine.add(id)
    return true
  })
  for (const id of mine) seen.add(id)
  return out
}

// Oldest file first, so the original keeps its lines and the copy loses them.
// A copy's lines carry the parent's timestamps, so the birth time tells them apart.
export function byBirth(dir, files) {
  const born = (f) => {
    const s = statSync(join(dir, f))
    return s.birthtimeMs || s.mtimeMs
  }
  return [...files].sort((a, b) => born(a) - born(b))
}

const fmtM = (n) => `${(n / 1e6).toFixed(1)}M`
const fmtHm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`

// One row for a session: its main transcript plus every subagent's. Pass one
// `seen` set across sessions to count each message once.
export function sessionRow(baseDir, idPrefix, seen = new Set()) {
  const { id, mainFile, subDir, subFiles } = resolveSession(baseDir, idPrefix)
  const main = dropSeen(readEntries(mainFile), seen)
  const rows = [timelineRow(main, 'navigator', 'navigator', id)]
  for (const f of subFiles) rows.push(timelineRow(dropSeen(readEntries(join(subDir, f)), seen), f, f, id))
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
  const files = ids.map((id) => resolveSession(base, id).id + '.jsonl')
  const seen = new Set()
  const all = byBirth(base, files).map((f) => sessionRow(base, f.slice(0, -'.jsonl'.length), seen))
  // A copy with nothing of its own left has no row; the footnote counts it.
  const sessions = all.filter((s) => s.tokens > 0 || s.calls > 0).sort((a, b) => a.first - b.first)
  console.log(tableOf(sessions))
  if (all.length > sessions.length) console.log(`\n${all.length - sessions.length} transcript(s) were only copies of an earlier one (same message ids) and are left out.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
