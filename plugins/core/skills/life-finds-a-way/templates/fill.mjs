#!/usr/bin/env node
// Renders the starter's templates into a new project from one values file:
//
//   node fill.mjs <values.json> <target dir> [--plans <dir>] [--force]
//   node fill.mjs <values.json> <project dir> --adopt [--plans <dir>]   (adopt or rerun: only missing files)
//
// --force is for a scratch folder only: it overwrites project files. Plans files
// (roadmap.md, V0.1.md) live outside git, so nothing can bring them back: an existing
// one is never overwritten, by any flag.
//   node fill.mjs --allow <values.json>   (the merged allow list for the settings row)
//   node fill.mjs --detect <dir>          (adopt's stack: node, python or other)
//
// Filling by hand was the heaviest lane of 2.14.8's render check; this makes it one
// call. Everything is rendered in memory first and written only when no placeholder
// is left, so a failed run never leaves a half-filled project behind.
//
// Values: nested objects, `{{project.name}}` reads values.project.name. A value of
// "" counts as filled. Two kinds of list:
//   - an array of objects at a prefix (`"part": [{ "name": …, "tag": … }]`) repeats
//     every line that uses that prefix, once per item (`- {{part.name}}: {{part.tag}}`);
//   - an array of strings at a leaf (`"reason": ["…", "…", "…"]`) fills that key's
//     occurrences in a file in order, and the count must match.
// `packs` (array of "release", "design", "database") says which pack-only files go in.
//
// Stacks (`stack`: "node", "python" or "other"; from research on a new project,
// detected in adopt). One rule for text that differs per stack, a marker:
//   - `<!-- stack:node,python -->` at a line's end keeps that line only for those stacks;
//   - the same marker alone on a line keeps every line up to `<!-- /stack -->`.
// `<!-- ui-only -->` works the same way at a line's end, for a dev server (devPort set).
// Markers are stripped from what's written. A file only some stacks get at all
// (check.mjs, launch.json) is gated in MAP below, like a pack-only file.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, chmodSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Template (relative to templates/) → where it goes. `plans:` targets land in the
// project's plans folder (`<plans><project.name>/`), not in the project. `pack`
// gates a file on a pack, `stack` on the stacks listed, `ui` on a dev server.
// Names inside templates/ are renamed on purpose: the production guard refuses
// real `.github/` and `scripts/check.sh` paths at any depth.
export const STACKS = ['node', 'python', 'other']
export const MAP = [
  { from: 'CLAUDE.md', to: 'CLAUDE.md' },
  { from: 'README.skeleton.md', to: 'README.md' },
  { from: 'dotclaude/kit.json', to: '.claude/kit.json' },
  { from: 'dotclaude/lessons.md', to: '.claude/lessons.md' },
  // launch.json starts `npm run dev`: only a Node project with a dev server has one.
  { from: 'dotclaude/launch.json', to: '.claude/launch.json', pack: 'design', ui: true, stack: ['node'] },
  { from: 'taste-seed.md', to: '.claude/taste.md', pack: 'design' },
  { from: 'docs/decisions/README.md', to: 'docs/decisions/README.md' },
  { from: 'docs/decisions/0001-start.md', to: 'docs/decisions/0001-start.md' },
  { from: 'check.mjs', to: 'scripts/check.mjs', stack: ['node'] },
  { from: 'check.sh.txt', to: 'scripts/check.sh', exec: true },
  { from: 'gitignore.txt', to: '.gitignore' },
  { from: 'env.example.txt', to: '.env.example' },
  { from: 'github/workflows/ci.yml', to: '.github/workflows/ci.yml' },
  { from: 'github/dependabot.yml', to: '.github/dependabot.yml' },
  { from: 'roadmap.md', to: 'plans:roadmap.md' },
  { from: 'V0.1.md', to: 'plans:V0.1.md' },
]

// The allow lists: core always, one per pack that's on, one per stack that has
// any (Other has none). Plain JSON, never rendered: the walkthrough's Mine row merges
// them into .claude/settings.json (the guard wants a person for that file); --allow
// prints the merged list for it.
const ALLOW = (values) => [
  'core',
  ...(values.packs ?? []).filter((p) => p !== 'core'),
  ...(['node', 'python'].includes(values.stack) ? [values.stack] : []),
]

// Not templates for the target.
const SKIP = new Set(['README.md', 'fill.mjs', 'fill.test.mjs'])
const SKIP_DIRS = new Set(['fixtures'])
const isAllowList = (rel) => /^dotclaude\/settings\.allow\.[a-z]+\.json$/.test(rel)

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g
const TRAILING_MARKER = /\s*<!-- (ui-only|stack:[a-z,]+) -->\s*$/
const BLOCK_OPEN = /^\s*<!-- stack:([a-z,]+) -->\s*$/
const BLOCK_CLOSE = /^\s*<!-- \/stack -->\s*$/

// Adopt never asks the stack: package.json means Node (checked first, so a Node app
// with a helper requirements.txt stays Node), a Python manifest means Python.
export function detectStack(dir) {
  if (existsSync(join(dir, 'package.json'))) return 'node'
  if (existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'requirements.txt'))) return 'python'
  return 'other'
}

export function allowList(values) {
  const out = []
  for (const name of ALLOW(values)) {
    const file = join(HERE, 'dotclaude', `settings.allow.${name}.json`)
    if (!existsSync(file)) continue
    for (const rule of JSON.parse(readFileSync(file, 'utf8')).permissions.allow) {
      if (!out.includes(rule)) out.push(rule)
    }
  }
  return out
}

function lookup(values, key) {
  let v = values
  for (const part of key.split('.')) {
    if (v === null || typeof v !== 'object' || Array.isArray(v) || !(part in v)) return undefined
    v = v[part]
  }
  return v
}

// The prefix of `key` that holds an array of objects, if any (`part` for `part.name`).
function repeatPrefix(values, key) {
  const parts = key.split('.')
  let v = values
  for (let i = 0; i < parts.length - 1; i++) {
    v = v?.[parts[i]]
    if (Array.isArray(v)) return parts.slice(0, i + 1).join('.')
    if (v === null || typeof v !== 'object') return null
  }
  return null
}

function listTemplates(dir = HERE, base = '') {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const rel = base ? base + '/' + name : name
    if (statSync(join(dir, name)).isDirectory()) {
      if (!SKIP_DIRS.has(rel)) out.push(...listTemplates(join(dir, name), rel))
    } else if (!SKIP.has(rel) && !isAllowList(rel)) out.push(rel)
  }
  return out
}

// Keeps a line or drops it by its markers, and strips them (the one stack rule).
function gate(text, { file, ui, stack }) {
  const errors = []
  const kept = []
  let block = null // the stacks of the open block, or null
  for (const raw of text.split('\n')) {
    const open = raw.match(BLOCK_OPEN)
    if (open) {
      if (block) errors.push(`${file}: a stack block opens inside another`)
      block = open[1].split(',')
      continue
    }
    if (BLOCK_CLOSE.test(raw)) {
      if (!block) errors.push(`${file}: <!-- /stack --> with no block open`)
      block = null
      continue
    }
    let line = raw
    let keep = !block || block.includes(stack)
    for (let m = line.match(TRAILING_MARKER); m; m = line.match(TRAILING_MARKER)) {
      if (m[1] === 'ui-only') keep &&= ui
      else keep &&= m[1].slice('stack:'.length).split(',').includes(stack)
      line = line.slice(0, m.index)
    }
    if (keep) kept.push(line)
  }
  if (block) errors.push(`${file}: a stack block is never closed`)
  for (const s of new Set([...text.matchAll(/<!-- stack:([a-z,]+) -->/g)].flatMap((m) => m[1].split(',')))) {
    if (!STACKS.includes(s)) errors.push(`${file}: unknown stack "${s}" in a marker`)
  }
  return { text: kept.join('\n'), errors }
}

export function renderText(text, values, { file, json, ui }) {
  const errors = []
  const seq = {} // leaf string-array cursors, per key
  const fmt = (v) => {
    if (typeof v === 'string') return json ? JSON.stringify(v).slice(1, -1) : v
    return String(v) // numbers, booleans and null go in bare (JSON's devPort)
  }
  const fill = (line, scope) =>
    line.replace(PLACEHOLDER, (whole, key) => {
      const v = lookup(scope, key)
      if (v === undefined) return whole
      if (Array.isArray(v)) {
        const i = (seq[key] = (seq[key] ?? -1) + 1)
        return i < v.length ? fmt(v[i]) : whole
      }
      if (v !== null && typeof v === 'object') return whole
      return fmt(v)
    })

  const gated = gate(text, { file, ui, stack: values.stack })
  errors.push(...gated.errors)
  const lines = []
  for (const line of gated.text.split('\n')) {
    const keys = [...line.matchAll(PLACEHOLDER)].map((m) => m[1])
    const prefixes = [...new Set(keys.map((k) => repeatPrefix(values, k)).filter(Boolean))]
    if (prefixes.length > 1) {
      errors.push(`${file}: one line repeats over two lists (${prefixes.join(', ')})`)
      lines.push(line)
    } else if (prefixes.length === 1) {
      const [prefix] = prefixes
      const items = lookup(values, prefix)
      for (const item of items) {
        // The item's fields shadow the prefix: {{part.name}} reads item.name.
        const scope = { ...values }
        let node = scope
        const parts = prefix.split('.')
        for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] = { ...node[parts[i]] }
        node[parts.at(-1)] = item
        lines.push(fill(line, scope))
      }
    } else {
      lines.push(fill(line, values))
    }
  }
  const out = lines.join('\n')

  for (const [key, cursor] of Object.entries(seq)) {
    const want = lookup(values, key).length
    if (cursor + 1 !== want) errors.push(`${file}: {{${key}}} appears ${cursor + 1} times, values give ${want}`)
  }
  for (const m of out.matchAll(PLACEHOLDER)) errors.push(`${file}: {{${m[1]}}} has no value`)
  if (json && !errors.length) {
    try {
      JSON.parse(out)
    } catch (e) {
      errors.push(`${file}: not valid JSON once filled (${e.message})`)
    }
  }
  return { out, errors }
}

function expandHome(p) {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

export function fill(values, target, { plansDir, force = false, adopt = false } = {}) {
  const errors = []
  const packs = values.packs
  if (!Array.isArray(packs)) errors.push('values: "packs" must be an array (release, design, database)')
  if (!STACKS.includes(values.stack)) errors.push(`values: "stack" must be one of ${STACKS.join(', ')}`)
  const ui = values.project?.devPort !== null && values.project?.devPort !== undefined

  const mapped = new Map(MAP.map((m) => [m.from, m]))
  for (const t of listTemplates()) {
    if (!mapped.has(t)) errors.push(`templates/${t}: no target in fill.mjs's MAP (add it, or to SKIP)`)
  }

  const name = values.project?.name
  const plansRoot = plansDir ?? (typeof values.plans === 'string' && name ? join(expandHome(values.plans), name) : null)

  // A new start refuses a non-empty project folder outright; adopt (and any rerun)
  // writes only what's missing and never touches an existing file (his edits stay).
  if (force && adopt) errors.push('--force and --adopt together: pick one (--adopt never overwrites)')
  if (!force && !adopt && existsSync(target) && readdirSync(target).length) {
    errors.push(`${target}: not empty: --adopt for a rerun or an existing project; --force only for a scratch folder`)
  }

  const writes = []
  const skipped = []
  for (const m of MAP) {
    if (m.pack && !(packs ?? []).includes(m.pack)) continue
    if (m.stack && !m.stack.includes(values.stack)) continue
    if (m.ui && !ui) continue
    const plans = m.to.startsWith('plans:')
    if (plans && !plansRoot) {
      errors.push(`${m.from}: no plans folder (values.plans and project.name, or --plans)`)
      continue
    }
    const dest = plans ? join(plansRoot, m.to.slice('plans:'.length)) : join(target, m.to)
    // Plans files that exist are steps 5 and 6's (Hammond's roadmap, the V0.1 draft):
    // skipped, and their values not needed. Outside git, so --force doesn't touch them.
    if ((plans || (adopt && !force)) && existsSync(dest)) {
      skipped.push(dest)
      continue
    }
    const text = readFileSync(join(HERE, m.from), 'utf8')
    const r = renderText(text, values, { file: 'templates/' + m.from, json: m.from.endsWith('.json'), ui })
    errors.push(...r.errors)
    writes.push({ dest, out: r.out, exec: m.exec })
  }
  if (errors.length) return { errors, written: [], skipped: [] }

  for (const w of writes) {
    mkdirSync(dirname(w.dest), { recursive: true })
    writeFileSync(w.dest, w.out)
    if (w.exec) chmodSync(w.dest, 0o755)
  }
  return { errors: [], written: writes.map((w) => w.dest), skipped }
}

function main(argv) {
  if (argv[0] === '--allow') {
    if (argv.length !== 2) {
      console.error('usage: node fill.mjs --allow <values.json>')
      return 2
    }
    console.log(JSON.stringify(allowList(JSON.parse(readFileSync(argv[1], 'utf8'))), null, 2))
    return 0
  }
  if (argv[0] === '--detect') {
    if (argv.length !== 2) {
      console.error('usage: node fill.mjs --detect <dir>')
      return 2
    }
    // A typo'd path would otherwise read as an empty folder and say "other".
    const dir = resolve(argv[1])
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      console.error(`fill: ${dir}: folder doesn't exist`)
      return 1
    }
    console.log(detectStack(dir))
    return 0
  }
  const force = argv.includes('--force')
  const adopt = argv.includes('--adopt')
  const pi = argv.indexOf('--plans')
  const plansDir = pi >= 0 ? resolve(argv[pi + 1] ?? '') : undefined
  const rest = argv.filter((a, i) => a !== '--force' && a !== '--adopt' && i !== pi && i !== pi + 1)
  if (rest.length !== 2 || (pi >= 0 && !argv[pi + 1])) {
    console.error('usage: node fill.mjs <values.json> <target dir> [--plans <dir>] [--force | --adopt]')
    return 2
  }
  const values = JSON.parse(readFileSync(rest[0], 'utf8'))
  const target = resolve(rest[1])
  const { errors, written, skipped } = fill(values, target, { plansDir, force, adopt })
  if (errors.length) {
    for (const e of errors) console.error('fill: ' + e)
    return 1
  }
  // Project files relative to the target; plans files (outside it) in full.
  const show = (w) => {
    const rel = relative(target, w)
    return rel.startsWith('..') ? w : rel
  }
  for (const w of written) console.log('written: ' + show(w))
  for (const w of skipped) console.log('skipped: exists ' + show(w))
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
