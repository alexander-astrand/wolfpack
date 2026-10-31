#!/usr/bin/env node
// The speed table `/jedi-council` reads: one row per session (the command it
// started with, wall-clock, agent-minutes, calls, tokens). A script because the
// scout that used to build it has no shell (the 3.3.2 council ran it by hand in
// one loop). It reuses usage.mjs's parser, so the numbers match Skyler's, and
// counts each message.id once across every file it reads (readEntries' `seen`).
// Kit 1.8 (F22): the Card column marks a small skill's session that became a
// release "session, not the skill", with the command's own first turn beside it.
//
// Usage: node council-speed.mjs [--dir <transcripts>] <session-id>…
//        node council-speed.mjs [--dir <transcripts>] --since <YYYY-MM-DD>
// Without --dir the transcripts are this project's (derived from the cwd).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dropCounted, hhmm, projectDir, readEntries, resolveSession, sessionCommand, timelineRow } from './usage.mjs'

const HELP = `Usage: node council-speed.mjs [--dir <transcripts>] <session-id>…
       node council-speed.mjs [--dir <transcripts>] --since <YYYY-MM-DD>
Prints a markdown table: session, command (or title), the card it counts on, wall-clock, agent-minutes, calls, tokens.`

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

// The command a session ran, read by usage.mjs's sessionCommand so the label
// matches Skyler's (a later command in brackets when the first prompt had
// none). Old names are counted under the new one: `/maverick` became
// `/captain-call` in kit 1.5, and a council compares releases across the rename.
const RENAMED = { maverick: 'captain-call' }

export function startCommand(entries) {
  return sessionCommand(entries).replace(/^(\(?)\/(?:([\w-]+):)?([\w-]+)(\)?)$/, (all, open, plugin, name, close) =>
    RENAMED[name] ? `${open}/${plugin ? `${plugin}:` : ''}${RENAMED[name]}${close}` : all,
  )
}

// The session's `project · kind · subject` title: the app writes a
// `custom-title` line each time it is set (`agent-name` is the same text), so
// the last one wins.
export function sessionTitle(entries) {
  let title = null
  for (const e of entries) {
    if (e?.type === 'custom-title' && e.customTitle) title = e.customTitle
    else if (e?.type === 'agent-name' && e.agentName && !title) title = e.agentName
  }
  return title
}

// What the speed table and the cards both call a session (M1, kit 1.6.1
// council: the two read the first prompt differently, and 87 sessions were
// "(none)"). The command when there is one; a session started by another with
// a brief takes its title; a release whose first prompt was a `/badger` call
// takes its title too, unless the title says it is the badger session.
const BADGER = /^\(?\/(?:[\w-]+:)?badger\)?$/
export function sessionLabel(entries) {
  const cmd = startCommand(entries)
  const title = sessionTitle(entries)
  if (cmd === '(none)') return title ? `title: ${title}` : '(none)'
  if (BADGER.test(cmd) && title && !/badger/i.test(title)) return `title: ${title} (started ${cmd.replace(/[()]/g, '')})`
  return cmd
}

// The skill a label counts under on the cards: `/release:captain-call` and
// `(/captain-call)` are both `captain-call`; a title label counts under none.
export function skillKey(label) {
  const m = /^\(?\/(?:[\w-]+:)?([\w-]+)\)?$/.exec(label || '')
  return m ? m[1].toLowerCase() : null
}

// A forked or resumed session starts its transcript with a byte-identical copy
// of its parent's lines, so summing files counted one session's work two or
// three times (J4, kit 1.4 council). usage.mjs's readEntries(file, seen) and
// dropCounted drop a message.id an earlier file already counted; the name stays
// for council-roles and council-skills, which import it (kit 1.5: one de-duplication).
export const dropSeen = (entries, seen) => (seen ? dropCounted(entries, seen) : entries)

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

// A prompt a person typed: not a tool result, not the skill body the app
// injects (isMeta), not a background note or a wake.
const NOT_TYPED = /^\s*<(task-notification|system-reminder|local-command|command-message)|^Caveat:/
export function typedPrompt(e) {
  if (e?.type !== 'user' || e.isMeta) return false
  const c = e.message?.content
  const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b) => b?.type === 'tool_result') ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : ''
  return Boolean(text.trim()) && !NOT_TYPED.test(text)
}

// When the first command's own turn ended: the second typed prompt, or never.
export function firstTurnEnd(entries) {
  let n = 0
  for (const e of entries) if (typedPrompt(e) && ++n === 2) return Date.parse(e.timestamp) || Infinity
  return Infinity
}

// Commands whose job is a whole release, audit or wrap: their session is the skill.
export const WHOLE_SESSION = new Set(['captain-call', 'cattle-drive', 'night-watch', 'one-ring', 'skinny-pete', 'jedi-council', 'avengers-assemble', 'black-box', 'no-half-measures', 'darth-vader', 'future-ted', 'inception', 'memento', 'life-finds-a-way', 'superlab'])
export const ARTEFACT_MIN = 20e6

// A card artefact (F22, kit 1.7.1 council): a session opened with a small
// skill and then used for a release (`/scrooge` 374.1M against 11.5M alone,
// `/ill-be-back` 824M) put the release's tokens on the skill's card. Flagged
// when the session is big, the command isn't a whole-session one, and its own
// first turn holds under a quarter of the tokens.
export const isArtefact = (s) => Boolean(s.skill) && !WHOLE_SESSION.has(s.skill) && s.tokens >= ARTEFACT_MIN && s.ownTokens != null && s.ownTokens < s.tokens / 4

// One row for a session: its main transcript plus every subagent's. Pass one
// `seen` set across sessions to count each message once.
export function sessionRow(baseDir, idPrefix, seen = new Set()) {
  const { id, mainFile, subDir, subFiles } = resolveSession(baseDir, idPrefix)
  // The label reads the whole file: a fork's copied first prompt is still its start.
  const raw = readEntries(mainFile)
  const label = sessionLabel(raw)
  const main = dropSeen(raw, seen)
  const rows = [timelineRow(main, 'navigator', 'navigator', id)]
  for (const f of subFiles) rows.push(timelineRow(readEntries(join(subDir, f), seen), f, f, id))
  const timed = rows.filter((r) => r.start)
  const first = timed.length ? Math.min(...timed.map((r) => r.start)) : 0
  const last = timed.length ? Math.max(...timed.map((r) => r.end)) : 0
  // The command's own cost: the navigator up to the second typed prompt, and
  // the agents started before it. Unknown when nobody typed a second prompt.
  const end = firstTurnEnd(raw)
  const ownTokens = end === Infinity ? null : timelineRow(main.filter((e) => !(Date.parse(e.timestamp) >= end)), 'own', 'own', id).tokens + rows.slice(1).filter((r) => r.start && r.start < end).reduce((s, r) => s + r.tokens, 0)
  return {
    id,
    command: label,
    skill: skillKey(label),
    first,
    wall: Math.round((last - first) / 60_000),
    agentMinutes: rows.reduce((s, r) => s + r.minutes, 0),
    calls: rows.reduce((s, r) => s + r.calls, 0),
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
    ownTokens,
  }
}

export function tableOf(sessions) {
  const out = [
    '| Session | Command or title | Card | Start | Wall-clock | Agent-min | Calls | Tokens |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const s of sessions) {
    out.push(
      `| ${s.id.slice(0, 8)} | ${s.command.replace(/\|/g, '/')} | ${s.skill ? (isArtefact(s) ? `${s.skill} (session, not the skill; its own turn ${fmtM(s.ownTokens)})` : s.skill) : '–'} | ${s.first ? hhmm(s.first) : '–'} | ${fmtHm(s.wall)} | ${s.agentMinutes} | ${s.calls} | ${fmtM(s.tokens)} |`,
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
