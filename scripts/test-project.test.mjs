// node --test kit/scripts/test-project.test.mjs — the standing marker check, shown
// to fail. Everything runs on stand-in projects in temp dirs (KIT_MARKER_ROOT for
// the child runs), never on this checkout's real markers.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { changed, snapshot } from './test-project.mjs'

const KIT = fileURLToPath(new URL('..', import.meta.url))
const PRELOAD = fileURLToPath(new URL('./test-project.node.mjs', import.meta.url))
const VITEST = join(KIT, '..', 'node_modules', '.bin', 'vitest')
const roots = []
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

function standIn() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kit-markers-')))
  roots.push(root)
  mkdirSync(join(root, '.claude'))
  return root
}
const marker = (root, name) => join(root, '.claude', name)

test('the clean case: nothing changed, nothing listed', () => {
  const root = standIn()
  writeFileSync(marker(root, 'full-auto.log'), 'line\n')
  assert.deepEqual(changed(snapshot([root]), snapshot([root])), [])
})

test('a full-auto*.json that appears is listed', () => {
  const root = standIn()
  const before = snapshot([root])
  writeFileSync(marker(root, 'full-auto-chain.json'), '{}')
  assert.deepEqual(changed(before, snapshot([root])), [marker(root, 'full-auto-chain.json')])
})

test('a log that appears, one that changes and one that disappears are all listed', () => {
  const root = standIn()
  writeFileSync(marker(root, 'full-auto.log'), 'a\n')
  writeFileSync(marker(root, 'permission-denied.log'), 'x\n')
  const before = snapshot([root])
  assert.equal(before[marker(root, 'full-auto-chain.log')], 'missing')
  writeFileSync(marker(root, 'full-auto-chain.log'), 'new\n') // missing → hash
  writeFileSync(marker(root, 'full-auto.log'), 'a\nb\n') // hash → another hash
  rmSync(marker(root, 'permission-denied.log')) // hash → missing
  assert.deepEqual(
    changed(before, snapshot([root])),
    ['full-auto-chain.log', 'full-auto.log', 'permission-denied.log'].map((n) => marker(root, n)),
  )
})

// A test file that writes the stand-in's chain marker, run by a real runner with
// KIT_MARKER_ROOT on the stand-in: the run must fail and name the marker.
function touching(dir, header) {
  const file = join(dir, 'touch.test.mjs')
  writeFileSync(
    file,
    `${header}
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
test('touches the stand-in marker', () => {
  writeFileSync(join(process.env.KIT_MARKER_ROOT, '.claude', 'full-auto-chain.json'), '{}')
})
`,
  )
  return file
}
// Without NODE_TEST_CONTEXT, which a child of a node --test file inherits and which
// makes its own `--test` skip every file as a recursive run.
const childEnv = (root) => {
  const env = { ...process.env, KIT_MARKER_ROOT: root }
  delete env.NODE_TEST_CONTEXT
  return env
}

test('node --test with the preload exits 1 when a test changes a marker', () => {
  const root = standIn()
  const file = touching(standIn(), "import { test } from 'node:test'")
  const r = spawnSync(process.execPath, ['--import', PRELOAD, '--test', file], { env: childEnv(root), encoding: 'utf8' })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout + r.stderr, /changed this checkout's drive markers/)
  assert.ok(existsSync(marker(root, 'full-auto-chain.json')))
  // The same file with no marker write passes: the failure is the check's, not the file's.
  const clean = join(standIn(), 'clean.test.mjs')
  writeFileSync(clean, "import { test } from 'node:test'\ntest('nothing', () => {})\n")
  assert.equal(spawnSync(process.execPath, ['--import', PRELOAD, '--test', clean], { env: childEnv(standIn()) }).status, 0)
})

test('vitest with the kit setup file fails a file that changes a marker', { skip: !existsSync(VITEST) && 'no vitest installed' }, () => {
  const root = standIn()
  const dir = standIn()
  touching(dir, '')
  // A config without imports (vitest/config doesn't resolve from a temp dir); globals
  // supply `test`, the kit's own setup file does the check.
  writeFileSync(
    join(dir, 'vitest.config.mjs'),
    `export default { test: { root: ${JSON.stringify(dir)}, include: ['*.test.mjs'], globals: true, setupFiles: [${JSON.stringify(join(KIT, 'vitest.setup.mjs'))}] } }\n`,
  )
  const r = spawnSync(VITEST, ['run', '--config', join(dir, 'vitest.config.mjs')], { cwd: dir, env: childEnv(root), encoding: 'utf8' })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout + r.stderr, /changed this checkout's drive markers/)
})
