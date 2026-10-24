#!/usr/bin/env node
// Writes the four Bengan Boys (tomas-svensson, magnus-wislander, staffan-olsson, stefan-lovgren)
// from skills/spidey-sense/bengan-boy-template.md, so their shared text can't drift apart.
// Kit 1.7 (jedi-council M4): the four were rewritten by hand from the template, and kit 1.5 found
// the template behind the four while spidey-sense said it wasn't.
//
//   node <design>/scripts/bengan-boys.mjs [--check] [--design <plugin folder>]
//
// Each Boy keeps his own four parts, read from his current file: {{NAME}} (the frontmatter name,
// also in his screenshot file name), {{DESCRIPTION}}, {{VOICE}} (the lines under `## Voice`) and
// {{LANE}} (the text under `## Your lane`). Everything else comes from the template. To change a
// Boy's lane or voice, edit his file there; to change the rest, edit the template; then run this.
// --check writes nothing and exits 1 naming each Boy whose file differs (the kit's tests run it).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BOYS = ['tomas-svensson', 'magnus-wislander', 'staffan-olsson', 'stefan-lovgren']

const here = dirname(fileURLToPath(import.meta.url))

// A Boy's own parts. Throws when a part is missing, so a broken file is never overwritten blind.
export function partsOf(text, file = 'agent') {
  const name = text.match(/^name: (.+)$/m)?.[1]
  const description = text.match(/^description: (.+)$/m)?.[1]
  // The voice card runs from its heading to the first blank line.
  const voice = text.match(/^## Voice\n([\s\S]*?)\n\n/m)?.[1]
  const lane = text.match(/^## Your lane\n([\s\S]*?)\n\n## /m)?.[1]
  const missing = Object.entries({ name, description, voice, lane })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new Error(`${file}: no ${missing.join(', ')}`)
  // A ': ' in the description breaks the frontmatter (spidey-sense's old rule).
  if (description.includes(': ')) throw new Error(`${file}: the description has ': ', which breaks the frontmatter`)
  return { name, description, voice, lane }
}

// A function replacer, so a `$` in a Boy's text is never read as a replace pattern.
export function fill(template, parts) {
  return template
    .replaceAll('{{NAME}}', () => parts.name)
    .replaceAll('{{DESCRIPTION}}', () => parts.description)
    .replaceAll('{{VOICE}}', () => parts.voice)
    .replaceAll('{{LANE}}', () => parts.lane)
}

export function run({ design = resolve(here, '..'), check = false } = {}) {
  const template = readFileSync(join(design, 'skills/spidey-sense/bengan-boy-template.md'), 'utf8')
  const drift = []
  for (const boy of BOYS) {
    const file = join(design, 'agents', `${boy}.md`)
    const now = readFileSync(file, 'utf8')
    const next = fill(template, partsOf(now, `${boy}.md`))
    if (next === now) continue
    drift.push(boy)
    if (!check) writeFileSync(file, next)
  }
  return drift
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n'))
    process.exit(0)
  }
  const i = args.indexOf('--design')
  try {
    const drift = run({ check: args.includes('--check'), design: i >= 0 ? resolve(args[i + 1]) : undefined })
    if (args.includes('--check')) {
      if (drift.length) console.log(`drift from the template: ${drift.join(', ')} (run bengan-boys.mjs to rewrite them)`)
      process.exit(drift.length ? 1 : 0)
    }
    console.log(drift.length ? `wrote ${drift.join(', ')}` : 'all four already match the template')
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
