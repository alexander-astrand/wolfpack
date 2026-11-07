#!/usr/bin/env node
// The ceiling hook (kit 1.10, council F1): a Stop hook that reads the session's
// tokens against the active skill's figure and, past it, sends the turn back
// once with one line. Kit 1.8 wrote these ceilings as sentences in the skills;
// none held (council H2: /inception 35 to 48M against 20M, /future-ted 43M
// against 25M, /mr-miyagi up to 55M against 20M, no ceiling line in any of the
// seven transcripts). A script is the shape that has held (the start gate, Hank).
//
// The active skill is the one usage.mjs's sessionCommand names: the first
// prompt's `<command-name>` (a skill he typed), else the first Skill call. A
// skill with no figure (the release skills: captain-call, cattle-drive,
// one-ring, which Hank and the start gate watch) leaves the hook silent.
// Tokens are the Usage table's count: the session and its subagents, each
// message once (usage.mjs sessionTokens).
//
// The line is sent once a session: a marker by session id (markerFor) makes
// every later stop pass, and `stop_hook_active` (this stop already came back
// once) always passes, so it never loops. Fails open: any error lets the turn end.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fmtM, parseEntries, sessionCommand, sessionTokens } from '../scripts/usage.mjs'
import { logDecision } from './start-gate.mjs'

const M = 1_000_000

// One table: the figure (tokens) for each skill that has one. Talks 20M; wrap
// and plan skills 25M (the kit 1.8 figures). `88-mph` has one only when small.
export const CEILINGS = {
  'mr-miyagi': 20 * M,
  wilson: 20 * M,
  legendary: 20 * M,
  heisenberg: 20 * M,
  'farbror-vattenmelon': 20 * M,
  '88-mph small': 20 * M,
  'future-ted': 25 * M,
  inception: 25 * M,
  memento: 25 * M,
}

export const reasonFor = (skill, tokens) =>
  `Past the ${Math.round(CEILINGS[skill] / M)}M ceiling for /${skill} (${fmtM(tokens)}): finish the answer and end; a new topic is a fresh session.`

// The skill is named in the transcript's head; only that much is read for it.
export const HEAD_BYTES = 512 * 1024

/** The parsed entries in a transcript's first `bytes`; [] when it can't be read. */
export function headEntries(file, bytes = HEAD_BYTES) {
  if (!file || !existsSync(file)) return []
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const len = readSync(fd, buf, 0, bytes, 0)
    // A cut last line doesn't parse and is skipped.
    return parseEntries(buf.toString('utf8', 0, len))
  } finally {
    closeSync(fd)
  }
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('\n') : '')
const bare = (name) => name.replace(/^\(|\)$/g, '').replace(/^\//, '').replace(/^[\w-]+:/, '')

// The arguments the skill started with: `<command-args>` beside the typed
// command, or the Skill call's `args`.
function argsOf(entries, skill) {
  for (const e of entries) {
    const c = e.message?.content
    if (e.type === 'user') {
      const text = textOf(c)
      const name = /<command-name>\s*(\/?[\w:-]+)\s*<\/command-name>/.exec(text)?.[1]
      if (name && bare(name) === skill) return /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
    } else if (e.type === 'assistant' && Array.isArray(c)) {
      const call = c.find((p) => p?.type === 'tool_use' && p.name === 'Skill' && bare(String(p.input?.skill ?? '')) === skill)
      if (call) return String(call.input.args ?? '').trim()
    }
  }
  return ''
}

/** The active skill's key in CEILINGS (`88-mph small` for a small 88-mph), or null. */
export function activeSkill(entries) {
  const command = sessionCommand(entries)
  if (command === '(none)') return null
  const skill = bare(command)
  if (skill === '88-mph') return /^small\b/i.test(argsOf(entries, skill)) ? '88-mph small' : null
  return skill in CEILINGS ? skill : null
}

// The session's own file and its subagents' (budget-cap.mjs subagentPaths' layout).
function sessionFiles(input) {
  const dir = join(dirname(input.transcript_path), input.session_id ?? '', 'subagents')
  let subs = []
  try {
    subs = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
  } catch {
    // no subagents
  }
  return [input.transcript_path, ...subs]
}

/**
 * @param {object} input  the hook's stdin JSON
 * @param {{ logPath?: string | null, now?: number, markerDir?: string }} [env]
 * @returns {{ decision: 'block', reason: string } | null}
 */
export function decide(input, env = {}) {
  if (!input || input.stop_hook_active || !input.transcript_path) return null
  const skill = activeSkill(headEntries(input.transcript_path))
  if (!skill) return null
  const tokens = sessionTokens(sessionFiles(input))
  if (tokens <= CEILINGS[skill]) return null
  const marker = markerFor(input, env)
  if (existsSync(marker)) return null
  const reason = reasonFor(skill, tokens)
  try {
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, `${reason}\n`)
  } catch {
    // No marker: the line may come back next turn, which beats never sending it.
  }
  logDecision(input, 'ceiling', 'block', reason, env)
  return { decision: 'block', reason }
}

// One marker a session, written when the line is sent: his call is one line
// past the figure, not one every later turn (each send-back is a call on the
// whole context). In tmp, by session id, like Hank's state.
export function markerFor(input, env = {}) {
  const id = String(input.session_id || 'unknown').replace(/[^\w-]/g, '_')
  return join(env.markerDir ?? join(tmpdir(), '.ceiling'), id)
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let result = null
  try {
    result = decide(JSON.parse(raw))
  } catch {
    return // fail open
  }
  if (result) process.stdout.write(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main()
