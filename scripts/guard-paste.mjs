#!/usr/bin/env node
// The guard paste in one command: a person applies a frozen guard patch.
//
//   node scripts/guard-paste.mjs [<patch>] [--dry]
//
// The guard's files are frozen (`[frozen]` in core/lessons.md): a release
// builds the change on a lane branch, ships it as a patch under
// plugins/database/guard-paste/, and Alexander pastes it himself, from his own
// terminal, where no hook stands between him and the files. This script is
// that paste: it checks the checkout is clean and on a release branch, applies
// the patch with `git am --3way` (the lane's commits keep their authors and
// messages), runs the database plugin's hook tests and then `npm test` (the
// whole suite and the kit check, which reads hooks.json), and on green removes the
// patch folder in one more commit and pushes. On red it pushes nothing and
// prints how to undo. Default patch: the newest *.patch in guard-paste/.
// --dry prints the steps and runs none.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PASTE_DIR = join('plugins', 'database', 'guard-paste')
const HOOKS_DIR = join('plugins', 'database', 'hooks')

/** The newest patch in the paste folder, by name (kit-1.8 before kit-1.10 is fine to misorder: one at a time). */
export function defaultPatch(root = ROOT) {
  const dir = join(root, PASTE_DIR)
  if (!existsSync(dir)) return undefined
  const patches = readdirSync(dir).filter((f) => f.endsWith('.patch')).sort()
  return patches.length ? join(PASTE_DIR, patches.at(-1)) : undefined
}

/** The commands the paste runs, in order, as [file, args] pairs. */
export function steps(patch, head) {
  return [
    ['git', ['am', '--3way', patch]],
    // The hook tests first, as the fast gate; then the whole suite, which ends
    // with scripts/check.mjs: that is what validates hooks.json and any hook
    // the patch adds (kit 1.8's SessionEnd hook), which the hook tests never read.
    ['npx', ['vitest', 'run', HOOKS_DIR]],
    ['npm', ['test']],
    ['git', ['rm', '-r', '-q', PASTE_DIR]],
    ['git', ['commit', '-q', '-m', `Guard paste landed: ${patch.split('/').at(-1)} applied by a person`]],
    ['git', ['push', '-q']],
    // Printed only, for the undo line on a red run.
    ['undo', ['git', 'reset', '--hard', head]],
  ]
}

/** What a `git am` that stops (a conflict, a patch that doesn't apply) prints. */
export const AM_STOPPED = 'git am stopped (a conflict, or the patch does not apply); nothing tested or pushed. git am --abort undoes it.'

/** Why the checkout can't take the paste, or undefined when it can. */
export function refusal({ branch, dirty, patch }) {
  if (!patch) return `no patch in ${PASTE_DIR}`
  if (dirty) return 'the checkout has uncommitted changes: commit or set them aside first'
  if (!branch || branch === 'main') return 'paste onto the release branch, never main'
  return undefined
}

function run(file, args) {
  return execFileSync(file, args, { cwd: ROOT, stdio: 'inherit' })
}

function read(file, args) {
  return execFileSync(file, args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

// Node runs the real file, so a spaced or symlinked path compares as its real URL.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const dry = process.argv.includes('--dry')
  const given = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const patch = given ? relative(ROOT, resolve(given)) : defaultPatch()
  const branch = read('git', ['branch', '--show-current'])
  const dirty = read('git', ['status', '--porcelain']) !== ''
  const why = refusal({ branch, dirty, patch })
  if (why) {
    console.error(`guard-paste: ${why}`)
    process.exit(1)
  }
  const head = read('git', ['rev-parse', 'HEAD'])
  const plan = steps(patch, head)
  const undo = plan.pop()[1].join(' ')
  if (dry) {
    for (const [f, a] of plan) console.log(`${f} ${a.join(' ')}`)
    console.log(`(on red: ${undo})`)
    process.exit(0)
  }
  const [am, hookTests, fullTests, ...land] = plan
  try {
    run(...am)
  } catch {
    // git has printed the conflict itself; a stack trace under it only hid the way out.
    console.error(`guard-paste: ${AM_STOPPED}`)
    process.exit(1)
  }
  for (const [gate, what] of [[hookTests, 'the hook tests'], [fullTests, 'npm test (the whole suite and the kit check)']]) {
    try {
      run(...gate)
    } catch {
      console.error(`guard-paste: ${what} failed after the paste; nothing pushed. Undo with: ${undo}`)
      process.exit(1)
    }
  }
  for (const s of land) run(...s)
  console.log(`guard-paste: ${patch} applied, tests green, pushed on ${branch}.`)
}
