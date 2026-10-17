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
// and one Telegram line names it, so it never sits unseen.
//
// Fails open like Hank: any error of its own allows the call.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TOOL = 'mcp__ccd_session__start_session'
export const DENY_REASON = "Alexander's standing rule is the ask: start it with initiation user_asked (norms.md, Starting sessions)"
const CARD_KINDS = new Set(['own_initiative', 'offer'])
// The app's refusal in a woken turn, matched loosely so a reworded message still
// counts: "Start sessions only on the user's own words to you here; this turn
// runs an automated event, ... Propose the session instead" (Burrow, 14 and 17 Oct).
const REFUSAL = /start sessions only on the user|propose the session instead|this turn runs an automated event/i

const blocks = (e) => (Array.isArray(e?.message?.content) ? e.message.content : [])

// A user entry Alexander (or a wake) wrote, as opposed to one that only carries tool results.
function isRealUserMessage(e) {
  if (e?.type !== 'user' || e.isMeta) return false
  const c = e.message?.content
  if (typeof c === 'string') return true
  return Array.isArray(c) && c.some((b) => b?.type === 'text')
}

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b?.text ?? '').join('\n') : '')

/** True when the transcript, since its last real user message, holds the app's refusal of a start_session. */
export function refusedThisTurn(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false
  const entries = []
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // a line still being written
    }
  }
  let from = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRealUserMessage(entries[i])) {
      from = i
      break
    }
  }
  const starts = new Set()
  for (const e of entries.slice(from)) {
    for (const b of blocks(e)) {
      if (b?.type === 'tool_use' && b.name === TOOL) starts.add(b.id)
      if (b?.type === 'tool_result' && starts.has(b.tool_use_id) && REFUSAL.test(resultText(b.content))) return true
    }
  }
  return false
}

/**
 * @param {object} input  the hook's stdin JSON
 * @param {{ push?: (line: string) => void }} [env]
 * @returns {{ decision: 'deny', reason: string } | null}  null = say nothing
 */
export function decide(input, env = {}) {
  if (input?.tool_name !== TOOL) return null
  const ti = input.tool_input ?? {}
  // Starting a card that already exists: the proposal_id call carries no initiation.
  if (ti.proposal_id && !ti.initiation) return null
  if (!CARD_KINDS.has(ti.initiation)) return null
  if (refusedThisTurn(input.transcript_path)) {
    const project = basename(process.env.CLAUDE_PROJECT_DIR || input.cwd || 'project')
    ;(env.push ?? push)(`${project} · card left: ${ti.title || ti.name || 'untitled'} (start refused in a woken turn)`)
    return null
  }
  return { decision: 'deny', reason: DENY_REASON }
}

// One Telegram line through the dojo's script, when it's there; best effort.
function push(line) {
  if (process.env.WOLFPACK_NO_PUSH) return
  const script = join(homedir(), 'dojo', 'bin', 'miyagi-push.sh')
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
