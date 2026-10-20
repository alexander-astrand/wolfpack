#!/usr/bin/env node
// /leon's look at the kit's main checkout: it should sit on main, level with
// origin/main and clean, because kit work happens in lanes (20 Oct 2026: it was
// found on 88-mph-large-upgrade, 20 behind main, after a session built in it).
// Report only: it reads git and never fetches, switches, stashes or cleans.
// origin/main is as fresh as the last fetch, which the live checkout's sync
// (every 30 min on the Air) or wolfpack-pull (hourly on the Dell) makes.
//
//   node leon-kit.mjs [--kit <dir>]      (default ~/wolfpack)
//
// Prints one line: `KIT ok: ...`, `KIT off: ...` (each problem, joined by "; "),
// `KIT missing: <dir>` or `KIT unreadable: <dir> (<why>)`. Always exits 0.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The problems in a checkout's facts; empty when it is on main, level and clean.
export function kitProblems({ branch, behind, ahead, changed, untracked }) {
  const problems = []
  if (branch !== 'main') problems.push(branch ? `on ${branch}, not main` : 'detached, not on main')
  if (behind > 0) problems.push(`${behind} behind origin/main`)
  if (ahead > 0) problems.push(`${ahead} not on origin/main`)
  if (changed + untracked > 0) problems.push(`uncommitted: ${changed} changed, ${untracked} untracked`)
  return problems
}

// The facts, read with `git` (injected so the test needs no repo). Throws when
// git can't tell, which the caller prints as unreadable.
export function readKit(dir, git = defaultGit) {
  const branch = git(dir, ['branch', '--show-current']).trim()
  const count = (range) => Number.parseInt(git(dir, ['rev-list', '--count', range]).trim(), 10)
  const behind = count('HEAD..origin/main')
  const ahead = count('origin/main..HEAD')
  if (Number.isNaN(behind) || Number.isNaN(ahead)) throw new Error('rev-list gave no count')
  const lines = git(dir, ['status', '--porcelain']).split('\n').filter(Boolean)
  const untracked = lines.filter((l) => l.startsWith('??')).length
  return { branch, behind, ahead, changed: lines.length - untracked, untracked }
}

export function kitLine(dir, { git = defaultGit, exists = existsSync, shown = dir } = {}) {
  if (!exists(dir)) return `KIT missing: ${shown}`
  let facts
  try {
    facts = readKit(dir, git)
  } catch (e) {
    return `KIT unreadable: ${shown} (${String(e?.message ?? e).split('\n')[0]})`
  }
  const problems = kitProblems(facts)
  return problems.length
    ? `KIT off: ${shown} ${problems.join('; ')}`
    : `KIT ok: ${shown} on main, level with origin/main, clean`
}

function defaultGit(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--kit')
  const dir = at >= 0 && args[at + 1] ? args[at + 1] : join(homedir(), 'wolfpack')
  const shown = dir.startsWith(homedir() + '/') ? `~/${dir.slice(homedir().length + 1)}` : dir
  console.log(kitLine(dir, { shown }))
}
