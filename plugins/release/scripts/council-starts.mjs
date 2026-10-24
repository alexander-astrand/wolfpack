#!/usr/bin/env node
// The session-start count `/jedi-council` reads: per session, its
// `start_session` calls by initiation (`user_asked`, `own_initiative`) and how
// many the app refused. First the admiral's scratch `oi.mjs` (kit 1.6.1
// council, sweep); a standing script since kit 1.7 so the facts step is one
// call (council-facts.mjs) and no agent re-greps the transcripts.
//
// Usage: node council-starts.mjs --since <YYYY-MM-DD> [--dir <transcripts>]…
// Without --dir the transcripts are this project's (derived from the cwd).
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectDir, readEntries } from './usage.mjs'
import { sessionTitle } from './council-speed.mjs'

// The app's refusal texts for a start (the woken-turn rule, the standing ask).
const REFUSED = /start sessions only on the user|propose the session instead|this turn runs an automated event|standing rule is the ask/i

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text ?? '').join(' ') : '')

// Transcripts written on or after `from`, the main ones only (agents don't start sessions).
export function windowFiles(dir, from) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl') && statSync(join(dir, f)).mtimeMs >= from)
}

// One row per session that called start_session at least once.
export function startsOf(entries, id) {
  const results = new Map()
  for (const e of entries) {
    for (const b of Array.isArray(e?.message?.content) ? e.message.content : []) {
      if (b?.type === 'tool_result') results.set(b.tool_use_id, { text: resultText(b.content), error: !!b.is_error })
    }
  }
  const row = { id, title: sessionTitle(entries), byInitiation: {}, refused: 0, calls: 0 }
  const done = new Set()
  for (const e of entries) {
    if (e?.type !== 'assistant') continue
    for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b?.type !== 'tool_use' || !/start_session$/.test(b.name || '') || done.has(b.id)) continue
      done.add(b.id) // one tool_use can sit on several transcript lines
      row.calls += 1
      const how = b.input?.initiation || '(none)'
      row.byInitiation[how] = (row.byInitiation[how] || 0) + 1
      const r = results.get(b.id)
      if (r && (r.error || REFUSED.test(r.text))) row.refused += 1
    }
  }
  return row.calls ? row : null
}

export function startsTable(rows) {
  const kinds = [...new Set(rows.flatMap((r) => Object.keys(r.byInitiation)))].sort()
  const out = [`| Session | Title | ${kinds.join(' | ')} | Refused |`, `|---|---|${kinds.map(() => '---|').join('')}---|`]
  for (const r of rows) out.push(`| ${r.id.slice(0, 8)} | ${(r.title || '(none)').replace(/\|/g, '/')} | ${kinds.map((k) => r.byInitiation[k] || 0).join(' | ')} | ${r.refused} |`)
  const total = (k) => rows.reduce((s, r) => s + (r.byInitiation[k] || 0), 0)
  out.push(`| **Total** | ${rows.length} sessions | ${kinds.map(total).join(' | ')} | ${rows.reduce((s, r) => s + r.refused, 0)} |`)
  return out.join('\n')
}

export function startRows(dirs, from) {
  const rows = []
  for (const dir of dirs) {
    for (const f of windowFiles(dir, from)) {
      const row = startsOf(readEntries(join(dir, f)), f.slice(0, -'.jsonl'.length))
      if (row) rows.push(row)
    }
  }
  return rows
}

function main() {
  const argv = process.argv.slice(2)
  const dirs = []
  let since = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dirs.push(argv[++i])
    else if (argv[i] === '--since') since = argv[++i]
  }
  const from = Date.parse(since ?? '')
  if (Number.isNaN(from)) {
    console.log('Usage: node council-starts.mjs --since <YYYY-MM-DD> [--dir <transcripts>]…')
    process.exit(1)
  }
  console.log(startsTable(startRows(dirs.length ? dirs : [projectDir(null)], from)))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
