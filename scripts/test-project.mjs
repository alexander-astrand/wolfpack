// Keeps the kit's tests off the checkout they run in. Used by kit/vitest.setup.mjs
// (per test file) and kit/scripts/test-project.node.mjs (per node --test file).
//
// Chain 2.14.9, 15:32Z: a kit test ran `full-auto.sh done` without a project of its
// own, the script took the checkout as its project, and this checkout's armed chain
// was disarmed mid-run. So each test file runs with its cwd and CLAUDE_PROJECT_DIR
// in a fresh temp project (anything it spawns inherits both, and the hooks and
// full-auto.sh take CLAUDE_PROJECT_DIR as the root), and the checkout's markers are
// hashed before and after: any change fails the file, whatever route it took.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The marker paths a drive writes, relative to a project: every full-auto*.json
// (the arm and the chain markers) plus the three logs.
const LOGS = ['full-auto.log', 'full-auto-chain.log', 'permission-denied.log']
function markerPaths(root) {
  const dot = join(root, '.claude')
  const json = existsSync(dot) ? readdirSync(dot).filter((n) => /^full-auto.*\.json$/.test(n)) : []
  return [...new Set([...json, ...LOGS])].sort().map((n) => join(dot, n))
}

// A missing file hashes as "missing", so a marker that appears counts as a change.
export function snapshot(roots) {
  const out = {}
  for (const root of roots) {
    for (const p of markerPaths(root)) {
      out[p] = existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'missing'
    }
  }
  return out
}

export function changed(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((p) => (before[p] ?? 'missing') !== (after[p] ?? 'missing'))
    .sort()
}

// The checkouts to guard: the one the kit sits in and the session's project, if
// that's another. KIT_MARKER_ROOT replaces them, so a test can prove the check
// bites on a scratch stand-in without touching the real markers.
// Read when this module loads, before the test file does: a test's fixture
// (hooks/fixtures/kit-project.mjs) points CLAUDE_PROJECT_DIR at its own project.
const SESSION = process.env.CLAUDE_PROJECT_DIR
function guardedRoots() {
  if (process.env.KIT_MARKER_ROOT) return [resolve(process.env.KIT_MARKER_ROOT)]
  const roots = [resolve(KIT, '..')]
  if (SESSION && existsSync(SESSION) && !roots.includes(resolve(SESSION))) roots.push(resolve(SESSION))
  return roots
}
const ROOTS = guardedRoots()
const BEFORE = snapshot(ROOTS)

// Moves the process into a temp project: the one a fixture already set up (it
// carries the kit.json the test needs), else a fresh one. The returned leave()
// moves it back, removes a project it made, and returns the checkout marker
// paths that changed since this module loaded.
export function enterTempProject() {
  const saved = { cwd: process.cwd(), env: process.env.CLAUDE_PROJECT_DIR }
  const current = saved.env && resolve(saved.env)
  const fixture = current && current !== (SESSION && resolve(SESSION)) && !ROOTS.includes(current) && existsSync(current)
  const project = fixture ? current : realpathSync(mkdtempSync(join(tmpdir(), 'kit-test-project-')))
  if (!fixture) mkdirSync(join(project, '.claude'))
  process.env.CLAUDE_PROJECT_DIR = project
  process.chdir(project)
  return {
    project,
    leave() {
      process.chdir(saved.cwd)
      if (saved.env === undefined) delete process.env.CLAUDE_PROJECT_DIR
      else process.env.CLAUDE_PROJECT_DIR = saved.env
      if (!fixture) rmSync(project, { recursive: true, force: true })
      return changed(BEFORE, snapshot(ROOTS))
    },
  }
}

export const failure = (paths) =>
  `a kit test changed this checkout's drive markers (tests run in their own temp project): ${paths.join(', ')}`
