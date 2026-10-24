#!/usr/bin/env node
// ranjit generated, never copied (kit 1.7, council Feature 9, database fix 1).
// A project's deployer agent was a hand copy of the kit's template, and one
// sat 40 versions behind it (council H1): it still said "only through
// /skinny-pete" while /one-ring had replaced that path.
//
//   node <database>/scripts/sync-ranjit.mjs <project dir>          writes it
//   node <database>/scripts/sync-ranjit.mjs <project dir> --check  only compares
//
// It renders this plugin's templates/ranjit.md (a Supabase production) or
// templates/ranjit-no-database.md (`"production": "on-merge"`) with the
// project's values from its .claude/kit.json: each {{key}} is that key's value
// there (`{{project.name}}` is kit.json's project.name). The <… from
// .claude/kit.json> spans stay as they are: ranjit reads those at run time.
// A project with `"production": "none"`, or no refs.prod, has no ranjit.
//
// The target, .claude/agents/ranjit.md, is in the guard's frozen set, so the
// write runs where the guard allows it (Alexander, or a setup session); the
// check only reads, and a project's check runs it.
//
// Exit codes: 0 written or the same, 1 the copy differs (--check; the diff is
// printed), 2 usage, kit.json unreadable, or a placeholder with no value.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
export const TARGET = join('.claude', 'agents', 'ranjit.md')
// fill.mjs's shape: a GitHub expression `${{ … }}` is no placeholder.
const PLACEHOLDER = /(?<!\$)\{\{([^{}]+)\}\}/g

/** Which template a project's kit.json takes, or null when it has no deployer to generate. */
export function templateFor(kit) {
  if (kit?.production === 'on-merge') return 'ranjit-no-database.md'
  if (kit?.production === 'none') return null
  return kit?.refs?.prod ? 'ranjit.md' : null
}

function lookup(values, key) {
  let v = values
  for (const part of key.trim().split('.')) {
    if (v === null || typeof v !== 'object' || Array.isArray(v) || !(part in v)) return undefined
    v = v[part]
  }
  return v
}

/**
 * The template with every {{key}} filled from kit.json.
 * @returns {{ text: string, missing: string[] }}
 */
export function render(template, kit) {
  const missing = []
  const text = String(template).replace(PLACEHOLDER, (whole, key) => {
    const v = lookup(kit, key)
    if (v === undefined || v === null || v === '' || typeof v === 'object') {
      missing.push(key.trim())
      return whole
    }
    return String(v)
  })
  return { text, missing: [...new Set(missing)] }
}

/** A short line diff: each line that differs, by number, the copy's (-) against the template's (+). */
export function lineDiff(have, want) {
  const a = String(have).split('\n')
  const b = String(want).split('\n')
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) out.push(`${i + 1}- ${a[i]}`)
    if (b[i] !== undefined) out.push(`${i + 1}+ ${b[i]}`)
  }
  return out
}

/**
 * Renders and writes, or with check only compares. Pure but for the reads and
 * the write it is given.
 * @returns {{ code: number, out: string }}
 */
export function sync(project, { check = false, read = (f) => readFileSync(f, 'utf8'), write = writeOut, exists = existsSync } = {}) {
  let kit
  try { kit = JSON.parse(read(join(project, '.claude', 'kit.json'))) } catch (err) {
    return { code: 2, out: `sync-ranjit: ${join(project, '.claude', 'kit.json')} can't be read (${err?.code ?? err?.message ?? err})` }
  }
  const name = templateFor(kit)
  const target = join(project, TARGET)
  if (!name) {
    return exists(target) && check
      ? { code: 1, out: `sync-ranjit: kit.json names no production with a deployer ("production": "none", or no refs.prod), but ${TARGET} is there` }
      : { code: 0, out: `sync-ranjit: no ranjit for this project (kit.json's production is ${JSON.stringify(kit?.production ?? null)}, refs.prod ${kit?.refs?.prod ? 'set' : 'empty'})` }
  }
  const { text, missing } = render(read(join(TEMPLATES, name)), kit)
  if (missing.length) return { code: 2, out: `sync-ranjit: kit.json has no value for ${missing.map((k) => `{{${k}}}`).join(', ')}` }
  const have = exists(target) ? read(target) : null
  if (have === text) return { code: 0, out: `sync-ranjit: ${TARGET} matches templates/${name}` }
  if (check) {
    const diff = have === null ? ['(no file)'] : lineDiff(have, text)
    return { code: 1, out: [`sync-ranjit: ${TARGET} differs from templates/${name}; run sync-ranjit.mjs <project dir> to write it (a frozen file: Alexander or a setup session).`, ...diff].join('\n') }
  }
  write(target, text)
  return { code: 0, out: `sync-ranjit: wrote ${TARGET} from templates/${name}` }
}

function writeOut(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const rest = args.filter((a) => a !== '--check')
  if (rest.length !== 1) {
    process.stderr.write('usage: node sync-ranjit.mjs <project dir> [--check]\n')
    process.exit(2)
  }
  const { code, out } = sync(resolve(rest[0]), { check })
  // The diff goes to stdout with the rest; only a usage or setup error is stderr.
  ;(code === 2 ? process.stderr : process.stdout).write(`${out}\n`)
  process.exit(code)
}
