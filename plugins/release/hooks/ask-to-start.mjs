#!/usr/bin/env node
// Start it yourself: a Stop hook that sends a turn back when it ends by asking
// Alexander to start or open a session (kit 1.5, his words at the memento,
// 17 Oct 2026: "I've still been prompted alot for new sessions and have to
// tell them to start new sessions"). The session can call start_session with
// initiation user_asked itself; if the app refuses, it says so in one line.
//
// Reads the final text from `last_assistant_message` (the docs' field for it),
// else from the transcript's tail. Text only: a question box is out of reach.
// Blocks once per stop: `stop_hook_active` means this stop already came back once.
// Fails open: any error of its own lets the turn end.

import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const REASON = 'Start it yourself: start_session with initiation user_asked (norms.md, Starting sessions). If the app refuses, say so in one line.'

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

// The last assistant text in the transcript's final 256 kB.
export function lastAssistantText(file) {
  if (!file || !existsSync(file)) return ''
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      let e
      try {
        e = JSON.parse(lines[i])
      } catch {
        continue
      }
      if (e?.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
      const text = e.message.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
      if (text) return text
    }
    return ''
  } finally {
    closeSync(fd)
  }
}

/** @returns {{ decision: 'block', reason: string } | null} */
export function decide(input) {
  if (!input || input.stop_hook_active) return null
  const text = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : lastAssistantText(input.transcript_path)
  return asksToStart(text) ? { decision: 'block', reason: REASON } : null
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
