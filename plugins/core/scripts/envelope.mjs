#!/usr/bin/env node
// The envelope for a message between sessions (norms.md, "How sessions talk"):
// prints `[<project> · <kind>] <subject>:` for the message's first line, and
// logs one line to the switchboard so cross-project traffic can be read back
// later. Node only, no dependencies.
//
// Usage: node envelope.mjs <project> <kind> <subject…>
// SWITCHBOARD overrides the log path (tests use a temp file).

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function envelope(project, kind, subject) {
  return `[${project} · ${kind}] ${subject}:`
}

export function logLine(project, kind, subject, now = new Date()) {
  return `${now.toISOString()} [${project} · ${kind}] ${subject}\n`
}

export function switchboardPath(env = process.env) {
  return env.SWITCHBOARD || join(homedir(), 'dojo', 'notes', 'switchboard.md')
}

export function main(argv, env = process.env, out = console.log, err = console.error) {
  const [project, kind, ...rest] = argv
  const subject = rest.join(' ').trim()
  if (!project || !kind || !subject) {
    err('usage: envelope.mjs <project> <kind> <subject>')
    return 2
  }
  const path = switchboardPath(env)
  // First message on a new machine: the dojo folder may not exist yet.
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, logLine(project, kind, subject))
  out(envelope(project, kind, subject))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
