#!/usr/bin/env node
// Keeps the six builders in step with templates/builder.md. Each builder's
// file is its own head (frontmatter, Voice card, the "You are …" line) down to
// the marker line, then the template's body, written here. Edit the template,
// run this, commit both; the test beside it fails while any builder differs.
//
// Usage: node <release plugin>/scripts/make-builders.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BUILDERS = ['chris-de-kok', 'ahmed-och-ahmed', 'saul-goodman', 'jeff-winger', 'troy-and-abed', 'jesse-pinkman']
export const MARKER = '<!-- The body below is templates/builder.md, written by scripts/make-builders.mjs: edit the template, not this file. -->'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The file a builder should have: its head, the marker, then the template. */
export function expected(current, template) {
  const at = current.indexOf(MARKER)
  if (at < 0) throw new Error('no marker line')
  return `${current.slice(0, at)}${MARKER}\n\n${template}`
}

/** Builders whose file differs from the template; with `write`, rewrites them. */
export function sync({ write = false, dir = root } = {}) {
  const template = readFileSync(join(dir, 'templates', 'builder.md'), 'utf8')
  const stale = []
  for (const name of BUILDERS) {
    const file = join(dir, 'agents', `${name}.md`)
    const current = readFileSync(file, 'utf8')
    const want = expected(current, template)
    if (want === current) continue
    stale.push(name)
    if (write) writeFileSync(file, want)
  }
  return stale
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const check = process.argv.includes('--check')
  const stale = sync({ write: !check })
  if (check && stale.length) {
    console.error(`Out of step with templates/builder.md: ${stale.join(', ')}`)
    process.exit(1)
  }
  console.log(stale.length ? `${check ? 'Stale' : 'Rewrote'}: ${stale.join(', ')}` : 'All six builders match the template.')
}
