#!/usr/bin/env node
// The envelope for a message between sessions (norms.md, "How sessions talk"):
// prints `[<project> · <kind>] <subject>:` for the message's first line. It no
// longer logs to the dojo's switchboard: norms dropped that log and nothing read
// it back (kit 1.5). Node only, no dependencies.
//
// Usage: node envelope.mjs <project> <kind> <subject…>

import { fileURLToPath } from 'node:url'

export function envelope(project, kind, subject) {
  return `[${project} · ${kind}] ${subject}:`
}

export function main(argv, out = console.log, err = console.error) {
  const [project, kind, ...rest] = argv
  const subject = rest.join(' ').trim()
  if (!project || !kind || !subject) {
    err('usage: envelope.mjs <project> <kind> <subject>')
    return 2
  }
  out(envelope(project, kind, subject))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
