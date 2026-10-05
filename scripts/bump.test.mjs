// node --test kit/scripts/bump.test.mjs — bump.mjs on a temp copy of the kit's
// manifests, so no real version moves.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { isSemver } from './bump.mjs'

const SCRIPT = fileURLToPath(new URL('./bump.mjs', import.meta.url))
const KIT = fileURLToPath(new URL('..', import.meta.url))
const roots = []
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

// Only the manifests: the marketplace and each plugin's plugin.json.
function copy() {
  const root = mkdtempSync(join(tmpdir(), 'kit-bump-'))
  roots.push(root)
  cpSync(join(KIT, '.claude-plugin'), join(root, '.claude-plugin'), { recursive: true })
  for (const p of readdirSync(join(KIT, 'plugins'))) {
    mkdirSync(join(root, 'plugins', p), { recursive: true })
    cpSync(join(KIT, 'plugins', p, '.claude-plugin'), join(root, 'plugins', p, '.claude-plugin'), { recursive: true })
  }
  return root
}

const run = (root, ...args) => spawnSync('node', [SCRIPT, ...args, '--kit', root], { encoding: 'utf8' })
const read = (root, ...p) => readFileSync(join(root, ...p), 'utf8')
const json = (root, ...p) => JSON.parse(read(root, ...p))

test('moves plugin.json and the marketplace entry together, and nothing else', () => {
  const root = copy()
  const market = read(root, '.claude-plugin', 'marketplace.json')
  const plugin = read(root, 'plugins', 'database', '.claude-plugin', 'plugin.json')
  const r = run(root, 'database', '9.8.7')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(json(root, 'plugins', 'database', '.claude-plugin', 'plugin.json').version, '9.8.7')
  const entries = json(root, '.claude-plugin', 'marketplace.json').plugins
  assert.equal(entries.find((p) => p.name === 'database').version, '9.8.7')
  // The other plugins keep theirs.
  const old = JSON.parse(market).plugins
  for (const e of entries.filter((p) => p.name !== 'database')) {
    assert.equal(e.version, old.find((p) => p.name === e.name).version)
  }
  // Formatting kept: the only changed line in each file is the version line.
  const changed = (a, b) => a.split('\n').filter((l, i) => l !== b.split('\n')[i])
  assert.deepEqual(changed(read(root, '.claude-plugin', 'marketplace.json'), market), ['      "version": "9.8.7",'])
  assert.deepEqual(changed(read(root, 'plugins', 'database', '.claude-plugin', 'plugin.json'), plugin), [
    '  "version": "9.8.7",',
  ])
})

test('the wolfpack plugin, named like the marketplace itself, moves only its own entry', () => {
  const root = copy()
  const old = json(root, '.claude-plugin', 'marketplace.json')
  assert.equal(run(root, 'wolfpack', '2.0.0').status, 0)
  const now = json(root, '.claude-plugin', 'marketplace.json')
  for (const e of now.plugins) {
    assert.equal(e.version, e.name === 'wolfpack' ? '2.0.0' : old.plugins.find((p) => p.name === e.name).version)
  }
})

test('refuses an unknown plugin and writes nothing', () => {
  const root = copy()
  const before = read(root, '.claude-plugin', 'marketplace.json')
  const r = run(root, 'nope', '1.0.0')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /unknown plugin "nope"/)
  assert.equal(read(root, '.claude-plugin', 'marketplace.json'), before)
})

test('refuses a version that is not semver and writes nothing', () => {
  const root = copy()
  const before = read(root, 'plugins', 'core', '.claude-plugin', 'plugin.json')
  for (const v of ['1.2', 'v1.2.3', '01.2.3', '1.2.3.4', '']) {
    const r = run(root, 'core', v)
    assert.equal(r.status, 1, v)
    assert.match(r.stderr, /isn't a semver version/)
  }
  assert.equal(read(root, 'plugins', 'core', '.claude-plugin', 'plugin.json'), before)
})

test('semver: release, pre-release and build forms pass', () => {
  for (const v of ['0.0.1', '1.2.3', '10.20.30', '1.0.0-rc.1', '1.0.0-alpha+001']) assert.ok(isSemver(v), v)
})

test('usage error without two arguments', () => {
  assert.equal(run(copy(), 'core').status, 2)
})
