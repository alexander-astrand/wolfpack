#!/usr/bin/env node
// Has the project's own guard drifted from the kit's copy? The kit's database
// and release plugins started as copies of a project's `.claude/hooks/` and
// `.claude/agents/ranjit.md`; a fix made on one side only is a guard that
// protects one project and not the other (2.14.9.1).
//
// Each pair in drift-pairs.json must be equal once the replacement list is
// applied to the project side: the lines that differ by design (the plugin
// root instead of `.claude/hooks/`, placeholders instead of the project's
// refs). A replacement is `{ from, to }`, or `{ kit, to }` where `kit` names a
// key in the project's `.claude/kit.json` (`refs.dev`): the kit is public, so
// the project's values are read from there and never written in this folder.
//
// Only the guard's source files are paired: its tests, fixtures, entry,
// budget cap and ranjit.md differ by design (drift-pairs.json says why).
//
// Usage: node kit/scripts/drift.mjs [--json] [--hutzup <hooksDir>] [rootDir]
// — one line per pair, exit 1 on any drift. `--hutzup` (relative to rootDir)
// stands in for `.claude/hooks/`, to check a prototype before its paste. rootDir defaults to the folder above kit/; with no
// `.claude/hooks/` there (the kit checked on its own, as in the published
// marketplace) the check skips with one line and exits 0.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const get = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)

// `{ kit: 'refs.prod' }` falls back to PROD_REF in the project's own hook, as
// check.mjs's projectValues does: an older kit.json may not list it. Read as
// text, never imported: the hook is the project's and must not run from here.
function kitValue(root, key) {
  let value
  try {
    value = get(JSON.parse(readFileSync(join(root, '.claude', 'kit.json'), 'utf8')), key)
  } catch {
    // no kit.json: only the fallback below can answer
  }
  if (value === undefined && key === 'refs.prod') {
    try {
      value = /PROD_REF\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(join(root, '.claude', 'hooks', 'production-steps.mjs'), 'utf8'))?.[1]
    } catch {
      // the project has no such hook
    }
  }
  return typeof value === 'string' && value ? value : undefined
}

// The replacements as plain [from, to] pairs; a kit key the project doesn't
// set is dropped (it can't match anything there anyway).
export function resolveReplacements(list, root) {
  const out = []
  for (const r of Array.isArray(list) ? list : []) {
    const from = typeof r?.kit === 'string' ? kitValue(root, r.kit) : r?.from
    if (typeof from === 'string' && from && typeof r?.to === 'string') out.push([from, r.to])
  }
  return out
}

const HOOKS = '.claude/hooks/'

// `hooks` swaps the project side's `.claude/hooks/` for another folder (one
// relative to root), so a prototype of the next guard can be checked before
// it's pasted in.
const hutzupPath = (path, hooks) => (hooks && path.startsWith(HOOKS) ? join(hooks, path.slice(HOOKS.length)) : path)

// Lines on either side outside the longest common subsequence, so one added
// block counts once instead of shifting every line after it.
function changedLines(a, b) {
  let prev = new Uint32Array(b.length + 1)
  let row = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    }
    ;[prev, row] = [row, prev]
  }
  const common = prev[b.length]
  return a.length - common + (b.length - common)
}

export function comparePair(root, hutzup, kit, replacements) {
  for (const f of [hutzup, kit]) {
    if (!existsSync(join(root, f))) return { hutzup, kit, same: false, missing: f }
  }
  let text = readFileSync(join(root, hutzup), 'utf8')
  for (const [from, to] of replacements) text = text.split(from).join(to)
  const a = text.split('\n')
  const b = readFileSync(join(root, kit), 'utf8').split('\n')
  let first = 0
  while (first < a.length && first < b.length && a[first] === b[first]) first++
  if (first === a.length && first === b.length) return { hutzup, kit, same: true }
  return { hutzup, kit, same: false, lines: changedLines(a, b), first: { file: kit, line: first + 1 } }
}

export function checkDrift(root, { pairsFile = join(HERE, 'drift-pairs.json'), hooks } = {}) {
  if (!existsSync(join(root, hooks ?? HOOKS))) {
    return { skipped: true, reason: `no ${hooks ?? HOOKS} beside kit/: drift check skipped (the kit on its own)`, pairs: [] }
  }
  const config = JSON.parse(readFileSync(pairsFile, 'utf8'))
  const replacements = resolveReplacements(config.replacements, root)
  const files = Array.isArray(config.files) ? config.files : []
  const pairs = files.map((p) => comparePair(root, hutzupPath(p.hutzup, hooks), p.kit, replacements))
  return { skipped: false, drift: pairs.some((p) => !p.same), pairs }
}

export function describe(p) {
  if (p.same) return `${p.hutzup} ↔ ${p.kit}: same`
  if (p.missing) return `${p.hutzup} ↔ ${p.kit}: differs: ${p.missing} is missing`
  return `${p.hutzup} ↔ ${p.kit}: differs: ${p.lines} lines, first at ${p.first.file}:${p.first.line}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const at = args.indexOf('--hutzup')
  const hooks = at >= 0 ? args[at + 1] : undefined
  const root = resolve(args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1)) ?? join(HERE, '..', '..'))
  const result = checkDrift(root, { hooks })
  if (json) console.log(JSON.stringify(result, null, 2))
  else if (result.skipped) console.log(result.reason)
  else for (const p of result.pairs) console.log(describe(p))
  if (result.drift) process.exit(1)
}
