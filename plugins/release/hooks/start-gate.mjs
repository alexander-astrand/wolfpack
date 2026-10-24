#!/usr/bin/env node
// The start gate: a session starts the next session itself, it doesn't leave
// Alexander a card to click (kit 1.5, his ask at the memento, 17 Oct 2026:
// "I've still been prompted alot for new sessions"). The app's own prompt says
// `user_asked` only "when the user asked in words", and that beat the
// CLAUDE.md rule: 38 cards against 28 starts since 14 Oct. So this PreToolUse
// hook on `start_session` denies `own_initiative` and `offer`.
//
// One exception: the app refuses every start in a turn woken by a timer,
// another session's message or a starter's task, and there a card is the only
// way left. When this turn already holds that refusal, the card goes through
// and one Telegram line names the refused start, so it never sits unseen. A
// start with a preset, folder or host can't become a card (the app: "A
// proposal card cannot carry a host, folder, environment or preset yet"), so
// for those the gate sends the line and denies the card (kit 1.7, council M2:
// the 1.6 line said "card left" for a card that was never made).
//
// The gate sends the only Telegram line, once per refusal (the log below
// remembers it), so the session sends none of its own (norms.md).
//
// Every decision is one line in the project's `.claude/session-hooks.log`
// (kit 1.7, council Feature 2: "0 deny texts" couldn't be told from "never
// fired"). Gitignored with the rest of `.claude/`, like the database plugin's
// permission-denied.log. Tab-separated: UTC time, session id, hook, decision,
// reason.
//
// Fails open like Hank: any error of its own allows the call.

import { execFile } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TOOL = 'mcp__ccd_session__start_session'
// Said when the turn may be woken, since there the app refuses the very call this
// text asks for and norms.md says never re-spell it (council M2, release lens 12).
const WOKEN =
  'If this turn was woken (a timer, a hand-back, another session\'s message, or a session\'s first task from its starter), the app refuses start_session: send_message an existing session or leave the card, and never re-spell the call.'
export const DENY_REASON = `Alexander's standing rule is the ask: start it with initiation user_asked (norms.md, Starting sessions). ${WOKEN}`
export const NO_CARD_REASON =
  "The app refused this start (a woken turn) and a card can't carry a preset, folder or host, so no card is made. The start gate has sent Alexander the one Telegram line; send none of your own. send_message an existing session of that project, or tell your starter where the work belongs, and stop. Never re-spell the call."
const CARD_KINDS = new Set(['own_initiative', 'offer'])
// What a proposal card can't carry (the app's refusal text, 23 Oct 2026).
const NO_CARD_FIELDS = ['preset', 'cwd', 'host', 'environment']
// The app's refusal in a woken turn, matched loosely so a reworded message still
// counts: "Start sessions only on the user's own words to you here; this turn
// runs an automated event, ... Propose the session instead" (Burrow, 14 and 17 Oct).
const REFUSAL = /start sessions only on the user|propose the session instead|this turn runs an automated event/i
// A brief named in the start's prompt, so the line says where it is.
const BRIEF = /(?:~|\/)[^\s`'"()<>]+\.md\b/

// Only the transcript's tail is read: a long session's file runs to tens of MB
// and the gate sits on every start (council M10's whole-file read).
export const TAIL_BYTES = 2 * 1024 * 1024
export const LOG_NAME = 'session-hooks.log'

const blocks = (e) => (Array.isArray(e?.message?.content) ? e.message.content : [])

/** The parsed entries in a transcript's last `bytes`; [] when it can't be read. */
export function tailEntries(file, bytes = TAIL_BYTES) {
  if (!file || !existsSync(file)) return []
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    // A cut first line is half an entry.
    if (len < size) lines.shift()
    const out = []
    for (const line of lines) {
      if (!line) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // a line still being written
      }
    }
    return out
  } finally {
    closeSync(fd)
  }
}

// A user entry Alexander (or a wake) wrote, as opposed to one that only carries tool results.
function isRealUserMessage(e) {
  if (e?.type !== 'user' || e.isMeta) return false
  const c = e.message?.content
  if (typeof c === 'string') return true
  return Array.isArray(c) && c.some((b) => b?.type === 'text')
}

/** The entries since the last real user message (the whole tail when none is in it). */
export function turnEntries(entries) {
  for (let i = entries.length - 1; i >= 0; i--) if (isRealUserMessage(entries[i])) return entries.slice(i)
  return entries
}

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b?.text ?? '').join('\n') : '')

/** The id of this turn's refused start_session call, or null. */
export function refusalThisTurn(entries) {
  const starts = new Set()
  for (const e of turnEntries(entries)) {
    for (const b of blocks(e)) {
      if (b?.type === 'tool_use' && b.name === TOOL) starts.add(b.id)
      if (b?.type === 'tool_result' && starts.has(b.tool_use_id) && REFUSAL.test(resultText(b.content))) return b.tool_use_id
    }
  }
  return null
}


const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** The project's hook log, or null when the folder has no `.claude/` (not a kit project). */
export function logPathFor(input) {
  const dir = join(process.env.CLAUDE_PROJECT_DIR || input?.cwd || '.', '.claude')
  return existsSync(dir) ? join(dir, LOG_NAME) : null
}

/** Appends one decision line; never throws. */
export function logDecision(input, hook, decision, reason, env = {}) {
  try {
    const file = 'logPath' in env ? env.logPath : logPathFor(input)
    if (!file || !existsSync(dirname(file))) return
    const line = [new Date(env.now ?? Date.now()).toISOString(), flat(input?.session_id) || '?', hook, decision, flat(reason).slice(0, 200)].join('\t')
    appendFileSync(file, `${line}\n`)
  } catch {
    // Best effort: a log must never get in the way of the work.
  }
}

// True when the log already holds the line sent for this refusal, so a second
// card call for the same refused start sends no second Telegram line.
function alreadyPushed(file, sessionId, refusalId) {
  try {
    if (!file) return false
    const tag = `refusal=${refusalId}`
    return tailLines(file, 64 * 1024).some((l) => {
      const c = l.split('\t')
      return c[1] === (sessionId || '?') && c[2] === 'start-gate' && c[4]?.includes(tag)
    })
  } catch {
    return false
  }
}

function tailLines(file, bytes) {
  if (!existsSync(file)) return []
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8').split('\n')
  } finally {
    closeSync(fd)
  }
}

/**
 * @param {object} input  the hook's stdin JSON
 * @param {{ push?: (line: string) => void, logPath?: string | null, now?: number }} [env]
 * @returns {{ decision: 'deny', reason: string } | null}  null = say nothing
 */
export function decide(input, env = {}) {
  if (input?.tool_name !== TOOL) return null
  const log = (decision, reason) => logDecision(input, 'start-gate', decision, reason, env)
  const ti = input.tool_input ?? {}
  // Starting a card that already exists: the proposal_id call carries no initiation.
  if (ti.proposal_id && !ti.initiation) {
    log('allow', 'starts an existing card')
    return null
  }
  if (!CARD_KINDS.has(ti.initiation)) {
    log('allow', `initiation ${ti.initiation || 'none'}`)
    return null
  }
  const refusal = refusalThisTurn(tailEntries(input.transcript_path))
  if (!refusal) {
    log('deny', `${ti.initiation} with no refusal this turn`)
    return { decision: 'deny', reason: DENY_REASON }
  }
  const project = basename(process.env.CLAUDE_PROJECT_DIR || input.cwd || 'project')
  const title = flat(ti.title || ti.name) || 'untitled'
  const noCard = NO_CARD_FIELDS.filter((k) => ti[k])
  const brief = typeof ti.prompt === 'string' ? ti.prompt.match(BRIEF)?.[0] : null
  const file = 'logPath' in env ? env.logPath : logPathFor(input)
  const first = !alreadyPushed(file, input.session_id, refusal)
  const line = `${project} · start refused: ${title}${brief ? `, brief at ${brief}` : ''}${noCard.length ? ' (woken turn, no card)' : ' (woken turn, a card follows)'}`
  if (first) (env.push ?? push)(line)
  const sent = first ? 'pushed' : 'already pushed'
  if (noCard.length) {
    log('deny', `woken turn, no card: ${noCard.join(',')}; ${sent} refusal=${refusal}`)
    return { decision: 'deny', reason: NO_CARD_REASON }
  }
  log('woken-turn card', `${sent} refusal=${refusal}`)
  return null
}

// One Telegram line through Pylos's script (Nestor's push), when it's there; best effort.
function push(line) {
  if (process.env.WOLFPACK_NO_PUSH) return
  const script = join(homedir(), 'pylos', 'bin', 'nestor-push.sh')
  if (!existsSync(script)) return
  try {
    execFile(script, [line], { timeout: 5000 }, () => {})
  } catch {
    // a failed push never fails the hook
  }
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
  if (!result) return
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } }),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
