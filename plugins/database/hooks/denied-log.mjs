#!/usr/bin/env node
// Logs every automatic refusal in Auto mode (the `PermissionDenied` hook, see
// .claude/settings.json) to `.claude/permission-denied.log`, gitignored by
// `*.log`. Why: the classifier's refusals left no trace, so a chain's review
// couldn't tell which calls were routed around, or how often (2.14.6).
//
// One tab-separated line per refusal: UTC time, agent (or `main`), tool, the
// head of the tool input with secrets masked, permission mode, session id.
// The hook's input carries no reason, so none is logged.
//
// It only ever writes the log: it exits 0 and prints nothing, and never sends
// `retry` (a retry is a refusal re-spelled, which the guard's rules forbid).

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const INPUT_HEAD = 200
const MASK_HEAD = 2000
// Without the guard's maskSecrets a shorter head leaves less room for a secret.
const UNMASKED_HEAD = 80

export function logPathFor(input) {
  return join(process.env.CLAUDE_PROJECT_DIR || input?.cwd || '.', '.claude', 'permission-denied.log')
}

// Lazily, so a broken guard file can't stop this hook: the fallback is the
// raw head, cut shorter.
async function loadMask() {
  try {
    const { maskSecrets } = await import('./guard-production.mjs')
    return typeof maskSecrets === 'function' ? maskSecrets : null
  } catch {
    return null
  }
}

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** The log line for one PermissionDenied input. */
export function deniedLine(input, { mask = null, now = Date.now() } = {}) {
  let tool
  try {
    tool = JSON.stringify(input.tool_input ?? {}) ?? ''
  } catch {
    tool = String(input.tool_input)
  }
  // Masked before the 200 cut, so a secret straddling it still matches; but on
  // a generous head only, since maskSecrets on a huge input (160k chars) takes
  // seconds against the hook's 5 s timeout.
  const head = mask ? flat(mask(tool.slice(0, MASK_HEAD))).slice(0, INPUT_HEAD) : flat(tool.slice(0, MASK_HEAD)).slice(0, UNMASKED_HEAD)
  return [
    new Date(now).toISOString(),
    flat(input.agent_type) || 'main',
    flat(input.tool_name) || '?',
    head,
    flat(input.permission_mode) || '?',
    flat(input.session_id) || '?',
  ].join('\t')
}

/**
 * Reads the hook's stdin text and appends its line. Never throws.
 * @param {string} raw  stdin
 * @param {{ logPath?: string, mask?: Function | null, now?: number }} [env]
 */
export async function run(raw, env = {}) {
  try {
    const input = JSON.parse(raw)
    if (!input || typeof input !== 'object') return
    const mask = 'mask' in env ? env.mask : await loadMask()
    const file = env.logPath ?? logPathFor(input)
    const line = deniedLine(input, { mask, now: env.now ?? Date.now() })
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${line}\n`)
  } catch {
    // Best effort: a logger must never get in the way of the work.
  }
}

async function main() {
  let raw = ''
  try {
    for await (const chunk of process.stdin) raw += chunk
  } catch {
    // nothing to log
  }
  await run(raw)
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
