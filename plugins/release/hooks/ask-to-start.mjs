#!/usr/bin/env node
// The Stop hook: it sends a turn back, once, when the turn ends in one of three
// ways the rules forbid.
//
// 1. Asking Alexander to start or open a session (kit 1.5, his words at the
//    memento, 17 Oct 2026: "I've still been prompted alot for new sessions and
//    have to tell them to start new sessions"). The session calls start_session
//    with initiation user_asked itself; in a woken turn the app refuses that, so
//    it messages an existing session or leaves the card (council M2).
// 2. Background work still running with no timer to wake the session
//    (`[watchdog]`; kit 1.7, council Feature 2).
// 3. A final message whose last line isn't `Next:` or `Handed to` (norms.md,
//    "Last line"; kit 1.7, council Feature 2), but only after a turn that ran
//    tools, so a plain chat answer is never sent back.
//
// Conservative by design: a wrong block in every session costs more than a
// missed one. Slash-command steps and go-questions pass; anything it can't read
// passes; `stop_hook_active` (this stop already came back once) always passes.
// The final text comes from `last_assistant_message` (the docs' field for it),
// else the transcript's tail; only the last 2 MB of the transcript are read.
// Each block is one line in `.claude/session-hooks.log` (see start-gate.mjs).
// Fails open: any error of its own lets the turn end.

import { pathToFileURL } from 'node:url'
import { logDecision, tailEntries, turnEntries } from './start-gate.mjs'

export const REASON =
  "Start it yourself: start_session with initiation user_asked (norms.md, Starting sessions). If this turn was woken (a timer, a hand-back, another session's message, or a session's first task from its starter), the app refuses start_session: send_message an existing session or leave the card, say so in one line, and never re-spell the call."
export const WATCHDOG_REASON =
  'Background work you started this turn is still running and no timer will wake you: start a background sleep timer before ending the turn ([watchdog]), or stop the tasks you no longer watch (TaskStop).'
export const NEXT_REASON =
  'End the final message with one last line: `Next: <the step> (<who>)`, `Handed to <starter title>; it has taken over.` or `Next: nothing, done.` (norms.md, Last line).'

// Only a sentence that names a session counts: "Want me to start the deploy?"
// or "Shall I open the PR?" are his go-questions, not session asks (kit 1.5
// review M1, 17 Oct 2026).
const NAMES_SESSION = /\bsessions?\b|\bfollow-up\b/i
// A sentence naming a slash command is a step only he can type (a user-only
// command, such as "open a new session and type /one-ring 1.5"), never a miss.
// Lowercase and ending at a word gap, so a path like /Users/x or /tmp/x isn't one.
const SLASH_COMMAND = /(?:^|[\s`'"(])\/[a-z][a-z0-9-]*(?=[\s`'".,:;?!)]|$)/
// Asked outright.
const ASKS = [/\b(?:want|like) me to (?:start|open|spin up|kick off)\b/i, /\b(?:shall|should) I (?:start|open|spin up|kick off)\b/i]
// Asking only as a question or a request to him; "I'll start a new session for X" is fine.
const NEW_SESSION = /\b(?:start|open|spin up) (?:a )?new session\b/i
const TO_HIM = /\?\s*$|^\s*(?:please\s+)?(?:start|open|spin up)\b|\byou\b/i

/** True when the text asks Alexander to start or open a session. */
export function asksToStart(text) {
  if (typeof text !== 'string' || !text) return false
  for (const sentence of text.split(/(?<=[.?!])\s+|\n+/)) {
    if (!NAMES_SESSION.test(sentence) || SLASH_COMMAND.test(sentence)) continue
    if (ASKS.some((re) => re.test(sentence))) return true
    if (NEW_SESSION.test(sentence) && TO_HIM.test(sentence)) return true
  }
  return false
}

const blocks = (e) => (e?.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : [])
const toolUses = (e) => blocks(e).filter((b) => b?.type === 'tool_use')

/** The last assistant text among the entries. */
export function lastText(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const text = blocks(entries[i]).filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
    if (text) return text
  }
  return ''
}

// Markdown in front of the label ("- **Next:**", "> Next:") still counts.
const LAST_LINE = /^(?:next\s*:|handed to\b)/i
const MARKUP = /^[\s>*_`#-]+/

/** True when the text's last non-empty line is a `Next:` or `Handed to` line, or one of the exemptions. */
export function endsWithNext(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return true
  const last = lines.at(-1)
  if (LAST_LINE.test(last.replace(MARKUP, ''))) return true
  // A go-question to him, or a step naming a command only he types, ends the turn as it is.
  return /\?[*_`)\s]*$/.test(last) || SLASH_COMMAND.test(last)
}

const isBackground = (b) => b?.input?.run_in_background === true
const isSleep = (b) => b?.name === 'Bash' && /\bsleep\s+\d/.test(String(b.input?.command ?? ''))
// Tools that wake the session on their own, besides a background sleep.
const TIMER_TOOL = /^(?:Monitor|ScheduleWakeup)$/
// The id a background start's result names: "Command running in background with
// ID: b3k9x", "agentId: a1b2c3". No id means the hook can't follow the task.
const TASK_ID = /\b(?:ID|agentId|task_?id|shell_?id)\s*[:=]\s*`?([A-Za-z0-9_-]{3,})/i

const resultOf = (entries, from, id) => {
  for (let i = from + 1; i < entries.length; i++) {
    const c = entries[i]?.message?.content
    if (!Array.isArray(c)) continue
    for (const b of c) {
      if (b?.type !== 'tool_result' || b.tool_use_id !== id) continue
      const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text ?? '').join('\n') : ''
      return { at: i, text }
    }
  }
  return null
}

/**
 * The background tasks started in this turn that look still running, and
 * whether a timer will wake the session. A task counts as finished when its id
 * shows up again after its start (a notification, TaskOutput, TaskStop).
 */
export function backgroundState(entries) {
  const turn = turnEntries(entries)
  const turnStart = entries.length - turn.length
  let running = 0
  let timer = false
  entries.forEach((e, i) => {
    for (const b of toolUses(e)) {
      const inTurn = i >= turnStart
      if (TIMER_TOOL.test(b.name ?? '') && inTurn) timer = true
      if (!isBackground(b)) continue
      const r = resultOf(entries, i, b.id)
      const id = r?.text.match(TASK_ID)?.[1]
      const later = id && r ? entries.slice(r.at + 1).some((x) => JSON.stringify(x).includes(id)) : false
      if (isSleep(b)) {
        // A sleep this turn, or an earlier one not yet seen to end, will wake the session.
        if (inTurn || !id || !later) timer = true
        continue
      }
      if (inTurn && id && !later) running++
    }
  })
  return { running, timer }
}

/**
 * @param {object} input  the hook's stdin JSON
 * @param {{ logPath?: string | null, now?: number }} [env]
 * @returns {{ decision: 'block', reason: string } | null}
 */
export function decide(input, env = {}) {
  if (!input || input.stop_hook_active) return null
  const entries = tailEntries(input.transcript_path)
  const text = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : lastText(entries)
  const block = (reason, why) => {
    logDecision(input, 'ask-to-start', 'block', why, env)
    return { decision: 'block', reason }
  }
  if (asksToStart(text)) return block(REASON, 'asks him to start a session')
  const { running, timer } = backgroundState(entries)
  if (running && !timer) return block(WATCHDOG_REASON, `${running} background task(s) running, no timer`)
  const ranTools = turnEntries(entries).some((e) => toolUses(e).length)
  if (ranTools && text && !endsWithNext(text) && !endsOnABox(entries)) return block(NEXT_REASON, 'no Next: last line')
  return null
}

// The app's end-of-turn box (wrap_up) or a question box is the turn's last act;
// nothing may follow it, so the text before it is not the final line.
function endsOnABox(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const c = blocks(entries[i])
    if (!c.length) continue
    const last = c.at(-1)
    return last?.type === 'tool_use' && /wrap_up|AskUserQuestion/i.test(last.name ?? '')
  }
  return false
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
